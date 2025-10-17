// ==UserScript==
// @name         U9A9 正则表达式过滤器 + 预览图 (简化图标 & 正向关键词)
// @namespace    http://tampermonkey.net/
// @version      8.8
// @description  使用更简洁的文本图标，支持正/负向关键词过滤，提供UI总开关，并分时加载预览图防止卡顿。
// @author       You
// @match        https://u9a9.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置 ---
    const KEYWORDS_STORAGE_KEY = 'u9a9_filter_keywords'; // 负向关键词
    const POSITIVE_KEYWORDS_STORAGE_KEY = 'u9a9_positive_keywords'; // 正向关键词
    const FILTER_ENABLED_KEY = 'u9a9_filter_enabled';
    const IMAGE_LOAD_DELAY_MS = 100; // 每张图片加载的间隔时间（毫秒）

    // --- [MODIFIED] 简化图标对象 ---
    const ICONS = {
        gear: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 0 0 2.572-1.065zM12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z"/></svg>`,
    };

    let imageObserver;

    // --- 数据管理 (无变动) ---
    function getKeywords() { return GM_getValue(KEYWORDS_STORAGE_KEY, []); }
    function saveKeywords(keywords) { GM_setValue(KEYWORDS_STORAGE_KEY, keywords); }
    function addKeyword(keyword) { if (!keyword || keyword.trim() === '') return false; const keywords = getKeywords(); const newKeyword = keyword.trim(); if (!keywords.includes(newKeyword)) { keywords.push(newKeyword); saveKeywords(keywords); return true; } return false; }
    function removeKeyword(keyword) { let keywords = getKeywords(); keywords = keywords.filter(k => k !== keyword); saveKeywords(keywords); }
    function getPositiveKeywords() { return GM_getValue(POSITIVE_KEYWORDS_STORAGE_KEY, []); }
    function savePositiveKeywords(keywords) { GM_setValue(POSITIVE_KEYWORDS_STORAGE_KEY, keywords); }
    function addPositiveKeyword(keyword) { if (!keyword || keyword.trim() === '') return false; const keywords = getPositiveKeywords(); const newKeyword = keyword.trim(); if (!keywords.includes(newKeyword)) { keywords.push(newKeyword); savePositiveKeywords(keywords); return true; } return false; }
    function removePositiveKeyword(keyword) { let keywords = getPositiveKeywords(); keywords = keywords.filter(k => k !== keyword); savePositiveKeywords(keywords); }
    function getFilterEnabled() { return GM_getValue(FILTER_ENABLED_KEY, true); }
    function saveFilterEnabled(enabled) { GM_setValue(FILTER_ENABLED_KEY, enabled); }

    // --- 核心过滤功能 (无变动) ---
    function applyFilterToEntry(entry) {
        if (!entry || !entry.matches || !entry.matches('tr.default')) return;
        if (!getFilterEnabled()) { entry.style.display = ''; injectPreviewImages(entry); return; }
        const titleElement = entry.querySelector('td:nth-child(2) a');
        if (!titleElement) { entry.style.display = ''; injectPreviewImages(entry); return; }
        const title = titleElement.textContent.trim();
        const positiveKeywords = getPositiveKeywords();
        const negativeKeywords = getKeywords();
        if (positiveKeywords.length > 0) { const isPositiveMatch = positiveKeywords.some(pattern => { try { return new RegExp(pattern, 'i').test(title); } catch { return false; } }); if (isPositiveMatch) { entry.style.display = ''; injectPreviewImages(entry); return; } }
        if (negativeKeywords.length > 0) { const isNegativeMatch = negativeKeywords.some(pattern => { try { return new RegExp(pattern, 'i').test(title); } catch { return false; } }); entry.style.display = isNegativeMatch ? 'none' : ''; } else { entry.style.display = ''; }
        injectPreviewImages(entry);
    }

    function runFullScan() {
        document.querySelectorAll('tr.default').forEach(applyFilterToEntry);
        updateFilterCount();
    }

    function updateFilterCount() {
        const badge = document.getElementById('filter-count-badge');
        if (!badge) return;
        if (!getFilterEnabled()) { badge.style.display = 'none'; return; }
        const hiddenEntries = document.querySelectorAll('tr.default[style*="display: none"]');
        const hiddenCount = hiddenEntries.length;
        badge.textContent = hiddenCount;
        badge.style.display = hiddenCount > 0 ? 'flex' : 'none';
    }

    // --- UI (过滤器控制面板) ---
    function initUI() {
        // --- [MODIFIED] 更新CSS，使用字体样式替代SVG样式 ---
        const styles = `
            :root {
                --filter-bg: #ffffff; --filter-border-color: #e5e7eb;
                --filter-primary-color: #3b82f6; --filter-primary-hover: #2563eb;
                --filter-danger-color: #f43f5e; --filter-danger-hover: #ef4444;
                --filter-positive-color: #22c55e; --filter-positive-hover: #16a34a;
                --filter-text-primary: #1f2937; --filter-text-secondary: #6b7280;
                --filter-disabled-color: #9ca3af;
            }
            #filter-container { position: fixed; top: 70px; right: 20px; z-index: 9999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            #filter-container.expanded { width: 260px; background: var(--filter-bg); border: 1px solid var(--filter-border-color); border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); }
            #filter-toggle-view { position: relative; width: 48px; height: 48px; background-color: var(--filter-primary-color); border-radius: 50%; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; transition: background-color 0.2s; }
            #filter-toggle-view:hover { background-color: var(--filter-primary-hover); }
            #filter-toggle-view.filter-disabled { background-color: var(--filter-disabled-color); }
            #filter-toggle-view.filter-disabled:hover { background-color: #6b7280; }
            #filter-toggle-view svg { width: 28px; height: 28px; color: white; } /* Keep for gear icon */
            #filter-container.expanded #filter-toggle-view { display: none; }
            #filter-container:not(.expanded) #filter-panel-view { display: none; }
            #filter-count-badge { position: absolute; top: 0px; right: 0px; background-color: var(--filter-danger-color); color: white; border-radius: 50%; min-width: 22px; height: 22px; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; border: 2px solid var(--filter-bg); display: none; }
            #filter-panel-view { padding: 12px 15px; }
            #filter-panel-view h3 { margin: 0 0 12px 0; color: var(--filter-text-primary); font-size: 18px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
            #close-panel-btn { background: none; border: none; cursor: pointer; padding: 4px; width: 28px; height: 28px; color: var(--filter-text-secondary); border-radius: 50%; transition: background-color 0.2s, color 0.2s; font-size: 24px; line-height: 1; display: flex; align-items: center; justify-content: center; }
            #close-panel-btn:hover { background-color: #f3f4f6; color: var(--filter-text-primary); }
            .keyword-input-area { display: flex; gap: 8px; margin-bottom: 12px; }
            .keyword-input-area input { flex-grow: 1; padding: 8px 12px; border: none; border-radius: 8px; font-size: 14px; background-color: #fafafa; transition: border-color 0.2s, box-shadow 0.2s; min-width: 40px; }
            .keyword-input-area input:focus { outline: none; border-color: var(--filter-primary-color); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
            .keyword-input-area button { flex-shrink: 0; width: 36px; height: 36px; padding: 0; color: white; border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.2s; font-size: 24px; font-weight: bold; line-height: 1; }
            #add-keyword-btn { background-color: var(--filter-danger-color); }
            #add-keyword-btn:hover { background-color: var(--filter-danger-hover); }
            #add-positive-keyword-btn { background-color: var(--filter-positive-color); }
            #add-positive-keyword-btn:hover { background-color: var(--filter-positive-hover); }
            .keyword-list { list-style: none; padding: 0; margin: 0 0 16px 0; max-height: 150px; overflow-y: auto; scrollbar-gutter: stable; background-color: #fafafa; border-radius: 8px; border: none; }
            .keyword-list li { padding: 8px 8px 8px 12px; display: flex; justify-content: space-between; align-items: center; transition: background-color 0.2s; border-bottom: none; }
            .keyword-list li:hover { background-color: #f3f4f6; }
            .keyword-list li:last-child { border-bottom: none; }
            .keyword-text { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; color: var(--filter-text-primary); }
            .remove-keyword-btn { background: none; border: none; cursor: pointer; padding: 0; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color: var(--filter-text-secondary); transition: background-color 0.2s, color 0.2s; flex-shrink: 0; font-size: 20px; font-weight: bold; line-height: 1; }
            .remove-keyword-btn:hover { color: white; background-color: var(--filter-danger-hover); }
            #positive-keyword-list .keyword-text { color: var(--filter-positive-hover); }
            #filter-panel-view h4 { font-size: 15px; font-weight: 600; color: var(--filter-text-primary); margin: 0 0 10px 0; border-top: 1px solid var(--filter-border-color); padding-top: 12px; }
            .toggle-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
            .toggle-switch input { opacity: 0; width: 0; height: 0; }
            .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 22px; }
            .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
            input:checked + .slider { background-color: var(--filter-primary-color); }
            input:checked + .slider:before { transform: translateX(18px); }
        `;
        const styleElement = document.createElement('style');
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);

        const container = document.createElement('div');
        container.id = 'filter-container';
        // --- [MODIFIED] 更新HTML，使用文本字符 ---
        container.innerHTML = `
            <div id="filter-toggle-view" title="打开/关闭过滤器 (左键单击展开, 中键单击开关)">${ICONS.gear}<span id="filter-count-badge"></span></div>
            <div id="filter-panel-view">
                <h3>
                    <span style="display: flex; align-items: center; gap: 10px;">
                        过滤器
                        <label class="toggle-switch">
                          <input type="checkbox" id="filter-master-switch">
                          <span class="slider"></span>
                        </label>
                    </span>
                    <button id="close-panel-btn" title="收起">&times;</button>
                </h3>

                <div class="keyword-input-area">
                    <input type="text" id="new-keyword-input" placeholder="回车或按添加">
                    <button id="add-keyword-btn" title="添加">+</button>
                </div>
                <ul id="keyword-list" class="keyword-list"></ul>

                <h4>强制保留关键词</h4>
                <div class="keyword-input-area">
                    <input type="text" id="new-positive-keyword-input" placeholder="回车或按添加">
                    <button id="add-positive-keyword-btn" title="添加">+</button>
                </div>
                <ul id="positive-keyword-list" class="keyword-list"></ul>
            </div>
        `;
        document.body.appendChild(container);

        // --- Event Listeners (无变动) ---
        const toggleView = document.getElementById('filter-toggle-view');
        toggleView.addEventListener('mousedown', (event) => { if (event.button === 0) { container.classList.add('expanded'); updateUIVisualState(); updateKeywordListUI(); updatePositiveKeywordListUI(); } else if (event.button === 1) { event.preventDefault(); saveFilterEnabled(!getFilterEnabled()); updateUIVisualState(); runFullScan(); } });
        document.getElementById('close-panel-btn').addEventListener('click', () => { container.classList.remove('expanded'); });
        const masterSwitch = document.getElementById('filter-master-switch');
        masterSwitch.addEventListener('change', () => { saveFilterEnabled(masterSwitch.checked); updateUIVisualState(); runFullScan(); });
        const newKeywordInput = document.getElementById('new-keyword-input');
        document.getElementById('add-keyword-btn').addEventListener('click', () => { if (addKeyword(newKeywordInput.value)) { newKeywordInput.value = ''; updateKeywordListUI(); runFullScan(); } newKeywordInput.focus(); });
        newKeywordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); document.getElementById('add-keyword-btn').click(); } });
        const newPositiveKeywordInput = document.getElementById('new-positive-keyword-input');
        document.getElementById('add-positive-keyword-btn').addEventListener('click', () => { if (addPositiveKeyword(newPositiveKeywordInput.value)) { newPositiveKeywordInput.value = ''; updatePositiveKeywordListUI(); runFullScan(); } newPositiveKeywordInput.focus(); });
        newPositiveKeywordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); document.getElementById('add-positive-keyword-btn').click(); } });
    }

    function updateUIVisualState() {
        const isEnabled = getFilterEnabled();
        const toggleView = document.getElementById('filter-toggle-view');
        const masterSwitch = document.getElementById('filter-master-switch');
        if (toggleView) toggleView.classList.toggle('filter-disabled', !isEnabled);
        if (masterSwitch) masterSwitch.checked = isEnabled;
    }

    // --- [MODIFIED] 更新创建列表项的函数，使用文本字符 ---
    function createKeywordListItem(keyword, onRemove) {
        const li = document.createElement('li');
        const textSpan = document.createElement('span');
        textSpan.className = 'keyword-text';
        textSpan.textContent = keyword;
        textSpan.title = keyword;
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-keyword-btn';
        removeBtn.title = `删除 "${keyword}"`;
        removeBtn.innerHTML = '&times;'; // 使用文本字符
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onRemove(keyword);
        });
        li.appendChild(textSpan);
        li.appendChild(removeBtn);
        return li;
    }

    function updateKeywordListUI() {
        const listElement = document.getElementById('keyword-list');
        if (!listElement) return;
        const keywords = getKeywords();
        listElement.innerHTML = '';
        if (keywords.length === 0) { listElement.innerHTML = `<li style="color: var(--filter-text-secondary); justify-content: center; padding: 20px; border: none; pointer-events: none;">暂无过滤关键词</li>`; return; }
        keywords.forEach(keyword => { const li = createKeywordListItem(keyword, () => { removeKeyword(keyword); updateKeywordListUI(); runFullScan(); }); listElement.appendChild(li); });
    }

    function updatePositiveKeywordListUI() {
        const listElement = document.getElementById('positive-keyword-list');
        if (!listElement) return;
        const keywords = getPositiveKeywords();
        listElement.innerHTML = '';
        if (keywords.length === 0) { listElement.innerHTML = `<li style="color: var(--filter-text-secondary); justify-content: center; padding: 20px; border: none; pointer-events: none;">暂无保留关键词</li>`; return; }
        keywords.forEach(keyword => { const li = createKeywordListItem(keyword, () => { removePositiveKeyword(keyword); updatePositiveKeywordListUI(); runFullScan(); }); listElement.appendChild(li); });
    }

    // --- 预览图提取 (无变动) ---
    const previewCache = new Map();
    async function loadImagesForRow(entry) {
        const link = entry.querySelector('td:nth-child(2) a');
        const previewContainer = entry.querySelector('.preview-thumbs');
        if (!link || !previewContainer) return;
        previewContainer.textContent = '加载预览中...';
        const detailUrl = link.href;
        const allImgs = await fetchPreviewImages(detailUrl);
        previewContainer.innerHTML = '';
        if (allImgs.length === 0) { previewContainer.textContent = '无预览图'; return; }
        allImgs.forEach((src, index) => {
            setTimeout(() => {
                if (!entry.isConnected) return;
                const imgEl = document.createElement('img');
                imgEl.src = src;
                imgEl.style.opacity = '0';
                imgEl.style.transition = 'opacity 0.4s ease';
                imgEl.onload = () => { imgEl.style.opacity = '1'; };
                imgEl.onerror = () => { imgEl.style.display = 'none'; };
                previewContainer.appendChild(imgEl);
            }, index * IMAGE_LOAD_DELAY_MS);
        });
    }
    async function fetchPreviewImages(detailUrl) {
        if (previewCache.has(detailUrl)) return previewCache.get(detailUrl);
        try { const resp = await fetch(detailUrl); const html = await resp.text(); const doc = new DOMParser().parseFromString(html, 'text/html'); const imgs = Array.from(doc.querySelectorAll('.img-container img')).map(img => img.getAttribute('src')).filter(Boolean).map(src => new URL(src, detailUrl).href); previewCache.set(detailUrl, imgs); return imgs; } catch (error) { console.error(`[U9A9 Preview Script] Failed to fetch images from ${detailUrl}:`, error); previewCache.set(detailUrl, []); return []; }
    }
    function injectPreviewImages(entry) { if (!entry || entry.dataset.previewInjected) return; entry.dataset.previewInjected = "1"; const link = entry.querySelector('td:nth-child(2) a'); if (!link) return; const previewContainer = document.createElement('div'); previewContainer.className = 'preview-thumbs'; previewContainer.textContent = '滚动到此处加载预览'; link.insertAdjacentElement('afterend', previewContainer); if (imageObserver) imageObserver.observe(entry); }
    function injectDynamicStyles() { const staticStyles = `.preview-thumbs { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; align-items: center; min-height: 20px; } .preview-thumbs img { max-height: 120px; max-width: 250px; border-radius: 4px; object-fit: cover; } .container { max-width: 1600px !important; width: 1600px !important; } table.table th:nth-child(3), table.table td:nth-child(3) { width: 100px; text-align: center; }`; let dynamicColumnStyles = ''; const headerCells = document.querySelectorAll('table.table thead th'); if (headerCells.length > 0) { const columnsToHideClasses = ['.hdr-category', '.hdr-size', '.hdr-date', '.hdr-ad']; const indicesToHide = []; headerCells.forEach((th, index) => { if (columnsToHideClasses.some(className => th.matches(className))) indicesToHide.push(index + 1); }); if (indicesToHide.length > 0) { const selectors = indicesToHide.map(index => `table.table th:nth-child(${index}), table.table td:nth-child(${index})`); dynamicColumnStyles = `${selectors.join(',\n')} { display: none; }`; } } const styleElement = document.createElement('style'); styleElement.textContent = staticStyles + '\n' + dynamicColumnStyles; document.head.appendChild(styleElement); }
    function initLazyLoader() { const options = { rootMargin: '100px 0px', threshold: 0.01 }; imageObserver = new IntersectionObserver((entries, observer) => { entries.forEach(entry => { if (entry.isIntersecting) { loadImagesForRow(entry.target); observer.unobserve(entry.target); } }); }, options); }
    function observeContentChanges() { const targetNode = document.querySelector('table.table tbody'); if (!targetNode) return; const observer = new MutationObserver((mutationsList) => { for (const mutation of mutationsList) { if (mutation.type === 'childList') { mutation.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE && node.matches('tr.default')) applyFilterToEntry(node); }); } } updateFilterCount(); }); observer.observe(targetNode, { childList: true }); }

    // --- 启动 ---
    window.addEventListener('load', () => {
        initUI();
        injectDynamicStyles();
        initLazyLoader();
        runFullScan();
        updateUIVisualState();
        observeContentChanges();
    });
})();