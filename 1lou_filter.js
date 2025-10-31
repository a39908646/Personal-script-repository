// ==UserScript==
// @name         BT之家 + 1lou 功能增强 (瀑布流卡片版)
// @namespace    https://github.com/a39908646
// @version      5.5.0
// @description  BTBTT/BT之家关键词过滤 + 1lou 瀑布流卡片 (仅论坛列表页) + 完整标题 + 磁力链接
// @author       a39908646
// @match        *://*.1lou.me/*
// @match        *://*.1lou.pro/*
// @match        *://*.1lou.icu/*
// @match        *://*.1lou.one/*
// @match        *://*.1lou.info/*
// @match        *://*.1lou.xyz/*
// @match        *://*.btbtt*.com/*
// @match        *://*.btbtt*.me/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  /* ------------------ 配置 ------------------ */
  const CONFIG = {
    IMAGE_TIMEOUT: 8000,
    MAX_CONCURRENT: 3,
    LAZY_LOAD_MARGIN: "300px",
    DEBOUNCE_DELAY: 300,
  };

  const SELECTORS = {
    THREAD: "li.media.thread, tr[id^='tr-thread-']",
    LIST_CONTAINER: ".threadlist, ul.media-list",
  };

  /* ------------------ 状态管理 ------------------ */
  const state = {
    includeRegex: [],
    excludeRegex: [],
    showCount: 0,
    hideCount: 0,
    panelVisible: GM_getValue("panelVisible", false),
    isThumbEnabled: GM_getValue("isThumbEnabled", true),
    isWaterfallMode: GM_getValue("isWaterfallMode", true),
    loadingTasks: new Set(),
    originalContents: new Map(),
  };

  /* ------------------ 工具函数 ------------------ */
  const debounce = (fn, wait) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  // 检测是否在论坛列表页（排除搜索页）
  const isForumListPage = () => {
    const hostname = location.hostname;
    const pathname = location.pathname;
    // 仅在 1lou 站点且是 forum 页面时返回 true，搜索页返回 false
    return hostname.includes("1lou.") && pathname.includes("/forum") && !pathname.includes("/search");
  };

  const showTip = (message, type = "info", duration = 2000) => {
    const tip = document.getElementById("filterTip");
    if (!tip) return;
    tip.textContent = message;
    tip.className = `filter-tip ${type}`;
    tip.style.opacity = "1";
    clearTimeout(tip._hideTimer);
    tip._hideTimer = setTimeout(() => (tip.style.opacity = "0"), duration);
  };

  /* ------------------ 磁力链接生成 ------------------ */
  const Bencode = {
    decode(data) {
      let pos = 0;
      const decode = () => {
        const char = String.fromCharCode(data[pos]);

        if (char === 'i') {
          pos++;
          let numStr = '';
          while (String.fromCharCode(data[pos]) !== 'e') numStr += String.fromCharCode(data[pos++]);
          pos++;
          return parseInt(numStr);
        }

        if (char === 'l') {
          pos++;
          const list = [];
          while (String.fromCharCode(data[pos]) !== 'e') list.push(decode());
          pos++;
          return list;
        }

        if (char === 'd') {
          pos++;
          const dict = {};
          while (String.fromCharCode(data[pos]) !== 'e') {
            dict[decode()] = decode();
          }
          pos++;
          return dict;
        }

        if (/\d/.test(char)) {
          let lenStr = '';
          while (String.fromCharCode(data[pos]) !== ':') lenStr += String.fromCharCode(data[pos++]);
          pos++;
          const len = parseInt(lenStr);
          const bytes = data.slice(pos, pos + len);
          pos += len;
          try {
            return new TextDecoder('utf-8').decode(bytes);
          } catch {
            return bytes;
          }
        }

        throw new Error('Invalid bencode');
      };

      return decode();
    }
  };

  async function sha1(data) {
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function findInfoBounds(data) {
    const infoKey = new TextEncoder().encode('4:info');
    let start = -1;

    for (let i = 0; i < data.length - infoKey.length; i++) {
      if (infoKey.every((byte, j) => data[i + j] === byte)) {
        start = i + infoKey.length;
        break;
      }
    }

    if (start === -1) return null;

    let depth = 0, i = start;
    while (i < data.length) {
      const char = String.fromCharCode(data[i]);
      if (char === 'd' || char === 'l') depth++, i++;
      else if (char === 'e') {
        if (depth === 0) return { start, end: i + 1 };
        depth--, i++;
      } else if (char === 'i') {
        i++;
        while (String.fromCharCode(data[i]) !== 'e') i++;
        i++;
      } else if (/\d/.test(char)) {
        let lenStr = '';
        while (String.fromCharCode(data[i]) !== ':') lenStr += String.fromCharCode(data[i++]);
        i++;
        i += parseInt(lenStr);
      } else i++;
    }

    return null;
  }

  async function torrentToMagnet(torrentUrl) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: torrentUrl,
        responseType: 'arraybuffer',
        onload: async (response) => {
          try {
            const data = new Uint8Array(response.response);
            const torrent = Bencode.decode(data);

            const infoBounds = findInfoBounds(data);
            if (!infoBounds) throw new Error('Info section not found');

            const infoBytes = data.slice(infoBounds.start, infoBounds.end);
            const hash = await sha1(infoBytes);

            const trackers = [];
            if (torrent.announce) trackers.push(torrent.announce);
            if (torrent['announce-list']) {
              torrent['announce-list'].flat().forEach(t => trackers.push(t));
            }

            let magnet = `magnet:?xt=urn:btih:${hash}`;
            if (torrent.info?.name) {
              magnet += `&dn=${encodeURIComponent(torrent.info.name)}`;
            }
            trackers.forEach(t => magnet += `&tr=${encodeURIComponent(t)}`);

            resolve(magnet);
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject
      });
    });
  }

  /* ------------------ 过滤功能 ------------------ */
  function applyFiltersToRow(li) {
    const item = li.querySelector(".subject.break-all, a.thread-title");
    if (!item) return;

    const text = item.textContent || "";
    const shouldInclude = state.includeRegex.length === 0 ||
                          state.includeRegex.every(re => re.test(text));
    const shouldExclude = state.excludeRegex.length > 0 &&
                          state.excludeRegex.some(re => re.test(text));

    if (shouldInclude && !shouldExclude) {
      li.style.display = "";
      li.classList.remove('filtered-out');
    } else {
      li.style.display = "none";
      li.classList.add('filtered-out');
    }
  }

  function applyFilters() {
    state.showCount = 0;
    state.hideCount = 0;

    document.querySelectorAll(SELECTORS.THREAD).forEach(li => {
      applyFiltersToRow(li);
      state[li.style.display === 'none' ? 'hideCount' : 'showCount']++;
    });

    updateStats();
  }

  const updateStats = () => {
    const showCountEl = document.getElementById("showCount");
    const hideCountEl = document.getElementById("hideCount");
    if (showCountEl) showCountEl.textContent = state.showCount;
    if (hideCountEl) hideCountEl.textContent = state.hideCount;
  };

  /* ------------------ 并发控制 ------------------ */
  class ConcurrencyController {
    constructor(maxConcurrent) {
      this.max = maxConcurrent;
      this.running = 0;
    }

    async run(task) {
      while (this.running >= this.max) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      this.running++;
      try {
        await task();
      } finally {
        this.running--;
      }
    }
  }

  const concurrencyController = new ConcurrencyController(CONFIG.MAX_CONCURRENT);

  /* ------------------ 卡片功能 ------------------ */
  function saveOriginalContent(li) {
    if (!state.originalContents.has(li)) {
      state.originalContents.set(li, li.innerHTML);
    }
  }

  function restoreOriginalContent(li) {
    const original = state.originalContents.get(li);
    if (original) {
      li.innerHTML = original;
      ['data-card-converted', 'data-thread-url', 'data-lazy-observer-attached', 'data-image-url']
        .forEach(attr => li.removeAttribute(attr));
    }
  }

  function convertToCard(li) {
    if (li.dataset.cardConverted) return;

    const link = li.querySelector(".subject a[href^='thread-'], a.thread-title");
    if (!link) return;

    saveOriginalContent(li);

    const title = link.textContent.trim();
    const url = link.href;

    li.innerHTML = `
      <div class="thread-card">
        <div class="card-image-wrap">
          <div class="card-loading">
            <div class="spinner"></div>
          </div>
        </div>
        <div class="card-content">
          <div class="card-title-wrap">
            <a href="${url}" class="card-title" title="${title}">${title}</a>
          </div>
          <div class="card-footer">
            <span class="card-date">加载中...</span>
            <div class="card-actions" style="display:none;">
              <button class="btn-magnet" title="复制磁力链接">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a2 2 0 0 1 2 2v4a2 2 0 1 1-4 0V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 1 0-6 0v4a3 3 0 0 0 6 0z"/>
                  <path d="M2 7a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm10 0a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2h-2a1 1 0 0 1-1-1z"/>
                </svg>
                磁力
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    li.dataset.cardConverted = 'true';
    li.dataset.threadUrl = url;
  }

  function setupLazyLoading(li) {
    if (!state.isThumbEnabled || li.dataset.lazyObserverAttached) return;
    if (!isForumListPage()) return;

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            observer.unobserve(li);
            const url = li.dataset.threadUrl;
            if (url) concurrencyController.run(() => fetchThreadData(li, url));
          }
        });
      },
      { rootMargin: CONFIG.LAZY_LOAD_MARGIN, threshold: 0.01 }
    );

    observer.observe(li);
    li.dataset.lazyObserverAttached = 'true';
  }

  function toggleWaterfallLayout() {
    const listContainer = document.querySelector(SELECTORS.LIST_CONTAINER);
    if (!listContainer) return;

    // 仅在论坛列表页启用瀑布流，搜索页不启用
    if (state.isWaterfallMode && isForumListPage()) {
      listContainer.classList.add('waterfall-container');
      document.querySelectorAll(SELECTORS.THREAD).forEach(li => {
        if (!li.classList.contains('filtered-out')) {
          convertToCard(li);
          setupLazyLoading(li);
        }
      });
    } else {
      listContainer.classList.remove('waterfall-container');
      document.querySelectorAll(SELECTORS.THREAD).forEach(restoreOriginalContent);
    }
  }

  /* ------------------ 数据提取 ------------------ */
  async function loadImage(li, imageUrl, threadUrl) {
    const cardWrap = li.querySelector('.card-image-wrap');
    if (!cardWrap) return;

    const img = document.createElement("img");
    img.className = "card-image";
    img.src = imageUrl;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Image load timeout')), CONFIG.IMAGE_TIMEOUT);

      img.onload = () => {
        clearTimeout(timeout);
        cardWrap.innerHTML = '';
        cardWrap.appendChild(img);
        img.onclick = () => window.location.href = threadUrl;
        resolve();
      };

      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Image load error'));
      };
    });
  }

  function createMagnetButton(torrentUrl) {
    return async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const btn = e.currentTarget;
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<div class="mini-spinner"></div>';
      btn.disabled = true;

      try {
        const magnet = await torrentToMagnet(torrentUrl);
        await navigator.clipboard.writeText(magnet);

        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
          </svg>
          已复制
        `;
        btn.classList.add('success');

        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.classList.remove('success');
          btn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error('磁力链接生成失败:', err);
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
          </svg>
          失败
        `;
        btn.classList.add('error');

        setTimeout(() => {
          btn.innerHTML = originalHTML;
          btn.classList.remove('error');
          btn.disabled = false;
        }, 2000);
      }
    };
  }

  async function fetchThreadData(li, url) {
    const cardWrap = li.querySelector('.card-image-wrap');
    if (!cardWrap || state.loadingTasks.has(url)) return;

    // 如果已有缓存的图片URL，直接加载
    if (li.dataset.imageUrl) {
      cardWrap.innerHTML = '<div class="card-loading"><div class="spinner"></div><div style="margin-top:8px;font-size:11px;">加载图片...</div></div>';
      try {
        await loadImage(li, li.dataset.imageUrl, url);
        return;
      } catch {
        delete li.dataset.imageUrl;
      }
    }

    state.loadingTasks.add(url);
    cardWrap.innerHTML = '<div class="card-loading"><div class="spinner"></div><div style="margin-top:8px;font-size:11px;">获取数据...</div></div>';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.IMAGE_TIMEOUT);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // 提取完整标题
      const titleEl = doc.querySelector('h4.break-all');
      if (titleEl) {
        titleEl.querySelectorAll('.badge').forEach(el => el.remove());
        const fullTitle = titleEl.textContent.trim();
        const cardTitle = li.querySelector('.card-title');
        if (cardTitle) {
          cardTitle.textContent = fullTitle;
          cardTitle.title = fullTitle;
        }
      }

      // 提取发帖时间
      const dateEl = doc.querySelector('.date.text-grey');
      if (dateEl) {
        const cardDate = li.querySelector('.card-date');
        if (cardDate) cardDate.textContent = dateEl.textContent.trim();
      }

      // 提取种子链接
      const torrentLink = doc.querySelector('.attachlist a[href*="attach-download"]');
      if (torrentLink) {
        const torrentUrl = new URL(torrentLink.href, url).href;
        const cardActions = li.querySelector('.card-actions');
        if (cardActions) {
          cardActions.style.display = 'flex';
          const btnMagnet = cardActions.querySelector('.btn-magnet');
          btnMagnet.onclick = createMagnetButton(torrentUrl);
        }
      }

      // 提取预览图
      const mainContent = doc.querySelector('.message.break-all');
      if (!mainContent) {
        cardWrap.innerHTML = '<div class="card-no-image">📄 无图片</div>';
        return;
      }

      const imageBlacklist = ['/avatar/', '/smiley/', '/rank/', '/filetype/', 'common/logo'];
      const imgs = mainContent.querySelectorAll("img");

      for (const img of imgs) {
        let src = img.getAttribute("src") || img.getAttribute("data-src");
        if (!src || imageBlacklist.some(kw => src.includes(kw))) continue;

        try {
          src = new URL(src, url).href;
          li.dataset.imageUrl = src;

          cardWrap.innerHTML = '<div class="card-loading"><div class="spinner"></div><div style="margin-top:8px;font-size:11px;">加载图片...</div></div>';
          await loadImage(li, src, url);
          return;
        } catch (e) {
          console.warn('图片加载失败:', e);
        }
      }

      cardWrap.innerHTML = '<div class="card-no-image">📄 无图片</div>';

    } catch (error) {
      console.error('数据获取失败:', url, error);

      const errorIcon = error.name === 'AbortError' ? '⏱️' : '❌';
      const errorMsg = error.name === 'AbortError' ? '请求超时' : '加载失败';

      cardWrap.innerHTML = `
        <div class="card-error">
          <div class="error-icon">${errorIcon}</div>
          <div class="error-msg">${errorMsg}</div>
          <button class="retry-btn">点击重试</button>
        </div>
      `;

      cardWrap.querySelector('.retry-btn').onclick = (e) => {
        e.stopPropagation();
        state.loadingTasks.delete(url);
        fetchThreadData(li, url);
      };
    } finally {
      state.loadingTasks.delete(url);
    }
  }

  /* ------------------ UI 控制 ------------------ */
  function toggleWaterfallMode(event) {
    state.isWaterfallMode = event.target.checked;
    GM_setValue("isWaterfallMode", state.isWaterfallMode);

    const thumbsCheckbox = document.getElementById("toggleThumbs");
    if (thumbsCheckbox) {
      thumbsCheckbox.disabled = !state.isWaterfallMode;
      thumbsCheckbox.parentElement.parentElement.style.opacity = state.isWaterfallMode ? '1' : '0.5';
    }

    toggleWaterfallLayout();
    showTip(state.isWaterfallMode ? "瀑布流模式已启用" : "已恢复原网站样式", "info");
  }

  function toggleThumbnailLoading(event) {
    state.isThumbEnabled = event.target.checked;
    GM_setValue("isThumbEnabled", state.isThumbEnabled);

    if (state.isThumbEnabled) {
      showTip("预览图已开启", "info");
      document.querySelectorAll(SELECTORS.THREAD).forEach(li => {
        if (!li.classList.contains('filtered-out') && li.dataset.cardConverted) {
          setupLazyLoading(li);
        }
      });
    } else {
      showTip("预览图已关闭", "info");
      state.loadingTasks.clear();
    }
  }

  /* ------------------ UI 面板 ------------------ */
  function createStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #filterPanel { position: fixed; top: 100px; right: -320px; width: 320px; background: white; padding: 15px; border: 1px solid #ccc; border-radius: 5px; z-index: 9999; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: right 0.3s ease-in-out; }
      #toggleFilter { position: absolute; left: -30px; top: 50%; transform: translateY(-50%); width: 30px; height: 60px; background: #4a90e2; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 5px 0 0 5px; font-size: 20px; }
      .panel-header { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; position: relative; height: 30px; }
      .panel-title { font-size: 16px; font-weight: bold; flex-shrink: 0; }
      .header-info { display: flex; align-items: center; gap: 8px; }
      .stats { text-align: right; color: #666; font-size: 11px; white-space: nowrap; }
      #shortcut-hint { position: relative; cursor: help; width: 16px; height: 16px; border-radius: 50%; background: #eee; color: #666; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; user-select: none; }
      #shortcut-hint::after { content: attr(data-tooltip); position: absolute; bottom: 125%; right: 50%; transform: translateX(50%); white-space: nowrap; background: #333; color: white; padding: 5px 10px; border-radius: 4px; font-size: 11px; z-index: 10000; opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s; pointer-events: none; }
      #shortcut-hint:hover::after { opacity: 1; visibility: visible; }
      .filter-tip { padding: 4px 12px; font-size: 13px; transition: opacity 0.3s ease; opacity: 0; white-space: nowrap; position: absolute; left: 105px; top: 50%; transform: translateY(-50%); }
      .filter-tip.info { color: #4a90e2; }
      .filter-tip.error { color: #e74c3c; }
      .filter-section { margin-bottom: 15px; }
      .filter-section h4 { font-size: 14px; margin-bottom: 5px; color: #333; }
      .filter-textarea { width: 100%; height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px; font-size: 12px; resize: vertical; box-sizing: border-box; }
      .filter-buttons { display: flex; justify-content: space-between; margin-top: 15px; }
      .filter-button { padding: 5px 15px; border: none; border-radius: 4px; cursor: pointer; background: #4a90e2; color: white; font-size: 12px; }
      .filter-button:hover { opacity: 0.9; }
      .filter-button.danger { background: #e74c3c; }
      .thumb-toggle-section { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee; }
      .thumb-toggle-section span { font-size: 14px; color: #333; }
      .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
      .switch input { opacity: 0; width: 0; height: 0; }
      .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 24px; }
      .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
      input:checked + .slider { background-color: #4a90e2; }
      input:focus + .slider { box-shadow: 0 0 1px #4a90e2; }
      input:checked + .slider:before { transform: translateX(20px); }
      input:disabled + .slider { opacity: 0.5; cursor: not-allowed; }

      .waterfall-container { column-count: 5; column-gap: 15px; padding: 15px; list-style: none; }
      .waterfall-container > li { break-inside: avoid; margin-bottom: 15px; display: inline-block; width: 100%; }
      .thread-card { background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); transition: transform 0.2s, box-shadow 0.2s; height: 100%; display: flex; flex-direction: column; }
      .thread-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
      .card-image-wrap { width: 100%; aspect-ratio: 2 / 3; background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%); display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; flex-shrink: 0; }
      .card-image { width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer; transition: transform 0.3s; background: #000; }
      .card-image:hover { transform: scale(1.02); }
      .card-loading { color: #999; font-size: 14px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
      .spinner { width: 30px; height: 30px; border: 3px solid #f3f3f3; border-top: 3px solid #4a90e2; border-radius: 50%; animation: spin 1s linear infinite; }
      .mini-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid #fff; border-top: 2px solid transparent; border-radius: 50%; animation: spin 0.6s linear infinite; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      .card-no-image { color: #ccc; font-size: 14px; }
      .card-error { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #999; padding: 20px; text-align: center; }
      .error-icon { font-size: 32px; }
      .error-msg { font-size: 13px; color: #999; }
      .retry-btn { margin-top: 5px; padding: 6px 16px; background: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s; }
      .retry-btn:hover { background: #357abd; }
      .retry-btn:active { transform: scale(0.95); }
      .card-content { padding: 12px; flex-grow: 1; display: flex; flex-direction: column; gap: 10px; }
      .card-title-wrap { flex-grow: 1; }
      .card-title { display: block; font-size: 13px; color: #333; text-decoration: none; line-height: 1.5; word-break: break-all; width: 100%; }
      .card-title:hover { color: #4a90e2; }
      .card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 8px; border-top: 1px solid #f0f0f0; gap: 8px; }
      .card-date { font-size: 11px; color: #999; flex-shrink: 0; }
      .card-actions { display: flex; gap: 8px; flex-shrink: 0; }
      .btn-magnet { display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; transition: all 0.2s; box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3); white-space: nowrap; }
      .btn-magnet:hover { transform: translateY(-1px); box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4); }
      .btn-magnet:active { transform: translateY(0); }
      .btn-magnet.success { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
      .btn-magnet.error { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); }
      .btn-magnet:disabled { opacity: 0.7; cursor: not-allowed; }

      @media (max-width: 1600px) { .waterfall-container { column-count: 4; } }
      @media (max-width: 1200px) { .waterfall-container { column-count: 3; column-gap: 12px; } }
      @media (max-width: 768px) { .waterfall-container { column-count: 2; column-gap: 10px; padding: 10px; } .card-title { font-size: 12px; } }
      @media (max-width: 480px) { .waterfall-container { column-count: 2; } }
    `;
    document.head.appendChild(style);
  }

  function createFilterPanel() {
    const panel = document.createElement("div");
    panel.id = "filterPanel";
    const includeKeywords = GM_getValue("includeKeywords", "2160p\n4K\nHDR");
    const excludeKeywords = GM_getValue("excludeKeywords", "国语配音\n合集");

    panel.innerHTML = `
      <div id="toggleFilter">◀</div>
      <div class="panel-header">
        <span class="panel-title">结果过滤器</span>
        <div id="filterTip" class="filter-tip"></div>
        <div class="header-info">
          <div class="stats">
            <span>显示: <b id="showCount">0</b></span>
            <span style="margin-left: 4px;">隐藏: <b id="hideCount">0</b></span>
          </div>
          <div id="shortcut-hint" data-tooltip="快捷键: Ctrl+Shift+F | Ctrl+Enter (保存)">?</div>
        </div>
      </div>
      <div class="filter-section">
        <h4>必须包含 (支持正则, 每行一个)</h4>
        <textarea id="includeKeywords" class="filter-textarea">${includeKeywords}</textarea>
      </div>
      <div class="filter-section">
        <h4>必须排除 (支持正则, 每行一个)</h4>
        <textarea id="excludeKeywords" class="filter-textarea">${excludeKeywords}</textarea>
      </div>
      <div class="filter-buttons">
        <button id="saveFilters" class="filter-button">保存并应用</button>
        <button id="resetFilters" class="filter-button danger">清空</button>
      </div>
      <div class="thumb-toggle-section">
        <span>瀑布流卡片模式</span>
        <label class="switch">
          <input type="checkbox" id="toggleWaterfall" ${state.isWaterfallMode ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="thumb-toggle-section" style="opacity: ${state.isWaterfallMode ? '1' : '0.5'}">
        <span>加载预览图 (仅1lou)</span>
        <label class="switch">
          <input type="checkbox" id="toggleThumbs" ${state.isThumbEnabled ? 'checked' : ''} ${!state.isWaterfallMode ? 'disabled' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `;
    document.body.appendChild(panel);

    if (state.panelVisible) {
      panel.style.right = "0";
      panel.querySelector("#toggleFilter").innerHTML = "▶";
    }

    addEventListeners();
  }

  function togglePanel() {
    const panel = document.getElementById("filterPanel");
    if (!panel) return;
    const toggleBtn = panel.querySelector("#toggleFilter");
    state.panelVisible = !state.panelVisible;
    panel.style.right = state.panelVisible ? "0" : "-320px";
    toggleBtn.innerHTML = state.panelVisible ? "▶" : "◀";
    GM_setValue("panelVisible", state.panelVisible);
  }

  function saveFilters() {
    const includeStr = document.getElementById("includeKeywords").value;
    const excludeStr = document.getElementById("excludeKeywords").value;
    GM_setValue("includeKeywords", includeStr);
    GM_setValue("excludeKeywords", excludeStr);

    const toRegex = (str) =>
      str.split(/[\n\r]+/).filter(k => k.trim()).map(k => {
        try {
          return new RegExp(k.trim(), "i");
        } catch (e) {
          showTip(`无效正则: ${k}`, "error");
          return null;
        }
      }).filter(Boolean);

    state.includeRegex = toRegex(includeStr);
    state.excludeRegex = toRegex(excludeStr);

    showTip("过滤规则已保存", "info");
    applyFilters();
  }

  function resetFilters() {
    document.getElementById("includeKeywords").value = "";
    document.getElementById("excludeKeywords").value = "";
    saveFilters();
    showTip("已清空所有规则", "info");
  }

  function addEventListeners() {
    document.getElementById("toggleFilter").addEventListener("click", togglePanel);
    document.getElementById("saveFilters").addEventListener("click", saveFilters);
    document.getElementById("resetFilters").addEventListener("click", resetFilters);
    document.getElementById("toggleWaterfall").addEventListener("change", toggleWaterfallMode);
    document.getElementById("toggleThumbs").addEventListener("change", toggleThumbnailLoading);

    const handleKeydown = (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        saveFilters();
      }
    };

    document.getElementById("includeKeywords").addEventListener("keydown", handleKeydown);
    document.getElementById("excludeKeywords").addEventListener("keydown", handleKeydown);

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  /* ------------------ 初始化 ------------------ */
  function initialize() {
    if (!document.querySelector(SELECTORS.LIST_CONTAINER)) return;

    createStyles();
    createFilterPanel();

    const includeStr = GM_getValue("includeKeywords", "2160p\n4K\nHDR");
    const excludeStr = GM_getValue("excludeKeywords", "国语配音\n合集");
    const toRegex = (str) =>
      str.split(/[\n\r]+/).filter(k => k.trim()).map(k => {
        try { return new RegExp(k.trim(), "i"); } catch { return null; }
      }).filter(Boolean);

    state.includeRegex = toRegex(includeStr);
    state.excludeRegex = toRegex(excludeStr);

    const processExistingItems = () => {
      document.querySelectorAll(SELECTORS.THREAD).forEach(item => {
        applyFiltersToRow(item);
        item.dataset.filterEnhanced = 'true';
      });
      applyFilters();

      // 仅在论坛列表页启用瀑布流
      if (state.isWaterfallMode && isForumListPage()) {
        toggleWaterfallLayout();
      }
    };

    const debouncedUpdateStats = debounce(() => {
      state.showCount = 0;
      state.hideCount = 0;
      document.querySelectorAll(SELECTORS.THREAD).forEach(li => {
        state[li.style.display === 'none' ? 'hideCount' : 'showCount']++;
      });
      updateStats();
    }, CONFIG.DEBOUNCE_DELAY);

    const processNewItems = (items) => {
      let hasNewItems = false;
      items.forEach(item => {
        if (item.dataset.filterEnhanced) return;
        item.dataset.filterEnhanced = 'true';

        applyFiltersToRow(item);

        if (state.isWaterfallMode && isForumListPage() && !item.classList.contains('filtered-out')) {
          convertToCard(item);
          setupLazyLoading(item);
        }

        hasNewItems = true;
      });

      if (hasNewItems) debouncedUpdateStats();
    };

    processExistingItems();

    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;

          if (node.matches?.(SELECTORS.THREAD)) {
            processNewItems([node]);
          } else if (node.querySelectorAll) {
            const newItems = node.querySelectorAll(SELECTORS.THREAD);
            if (newItems.length) processNewItems(newItems);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    console.log('✅ 1lou 增强脚本已启动', isForumListPage() ? '(论坛列表页 - 瀑布流已启用)' : '(搜索页 - 瀑布流已禁用)');
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();