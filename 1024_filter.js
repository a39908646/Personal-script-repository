// ==UserScript==
// @name         草榴社区显示优化、过滤
// @namespace    http://tampermonkey.net/
// @version      6.5.0
// @description  【正则模式】超时自动重试 | 一键重试按钮 | 帖子并发控制 | 分批懒加载 | 标记已阅 | 批量标记 | 自动清理过期记录
// @match        https://*.t66y.com/thread*
// @match        https://t66y.com/thread*
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

;(() => {
'use strict';

// ================================================================= //
//                       ★ 核心配置参数 ★
// ================================================================= //

const BATCH_SIZE = 6;                // 每个帖子每批次加载的图片数量
const MAX_CONCURRENT_POSTS = 2;      // 同时加载预览图的帖子数量上限
const IMAGE_LOAD_TIMEOUT = 10000;    // 图片加载超时时间（毫秒）
const MAX_RETRY_COUNT = 2;           // 图片加载失败最大自动重试次数
const READ_EXPIRE_DAYS = 30;         // 已阅记录过期天数（默认30天）

// ================================================================= //
//                       ★ 存储配置 ★
// ================================================================= //

const EXCLUDE_KEY = "excludeKeywords";
const PANEL_STATE_KEY = "filterPanelMinimized";
const FILTER_ENABLED_KEY = "filterEnabled";
const READ_POSTS_KEY = "readPosts";

// --- 存取函数 ---
const getExcludeKeywords = () => GM_getValue(EXCLUDE_KEY, []);
const setExcludeKeywords = (list) => GM_setValue(EXCLUDE_KEY, list);
const getPanelState = () => GM_getValue(PANEL_STATE_KEY, "max");
const setPanelState = (state) => GM_setValue(PANEL_STATE_KEY, state);
const getFilterEnabled = () => GM_getValue(FILTER_ENABLED_KEY, true);
const setFilterEnabled = (isEnabled) => GM_setValue(FILTER_ENABLED_KEY, isEnabled);

// 已阅记录存储结构: { postId: timestamp }
const getReadPosts = () => {
    const data = GM_getValue(READ_POSTS_KEY, {});
    // 兼容旧版本：如果是数组格式，转换为对象格式
    if (Array.isArray(data)) {
        const now = Date.now();
        const obj = {};
        data.forEach(id => obj[id] = now);
        GM_setValue(READ_POSTS_KEY, obj);
        return obj;
    }
    return data;
};
const saveReadPosts = (obj) => GM_setValue(READ_POSTS_KEY, obj);

let excludeKeywords, isFilterEnabled, readPosts;

// --- 全局数据存储 ---
const previewDataStore = new Map();

// --- 观察者 ---
let imageObserver, sentinelObserver, postObserver;

// ================================================================= //
//                    ★ Toast 提示功能 ★
// ================================================================= //

/**
 * 显示 Toast 提示
 * @param {string} message - 提示消息
 * @param {string} type - 提示类型: 'success' | 'error' | 'info'
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发动画
    setTimeout(() => toast.classList.add('show'), 10);

    // 3秒后自动消失
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ================================================================= //
//                    ★ 标记已阅功能 ★
// ================================================================= //

/**
 * 从链接元素提取帖子ID
 * @param {HTMLAnchorElement} linkElement - 帖子标题链接
 * @returns {string|null} 帖子ID
 */
function getPostId(linkElement) {
    if (!linkElement) return null;
    // 从 id 属性提取: "t7018236" -> "7018236"
    if (linkElement.id && linkElement.id.startsWith('t')) {
        return linkElement.id.replace('t', '');
    }
    // 备用方案: 从 href 提取
    const match = linkElement.href.match(/\/(\d+)\.html/);
    return match ? match[1] : null;
}

/**
 * 标记帖子为已阅
 * @param {string} postId - 帖子ID
 */
function markPostAsRead(postId) {
    if (!postId) return;
    readPosts[postId] = Date.now();
    saveReadPosts(readPosts);
}

/**
 * 检查帖子是否已阅
 * @param {string} postId - 帖子ID
 * @returns {boolean}
 */
function isPostRead(postId) {
    return postId && postId in readPosts;
}

/**
 * 清理过期的已阅记录
 * @returns {number} 清理的记录数
 */
function cleanExpiredReadPosts() {
    const now = Date.now();
    const expireTime = READ_EXPIRE_DAYS * 24 * 60 * 60 * 1000; // 转换为毫秒
    let cleanedCount = 0;

    Object.keys(readPosts).forEach(postId => {
        const timestamp = readPosts[postId];
        // 如果记录超过过期时间，或者时间戳无效
        if (!timestamp || (now - timestamp) > expireTime) {
            delete readPosts[postId];
            cleanedCount++;
        }
    });

    if (cleanedCount > 0) {
        saveReadPosts(readPosts);
        console.log(`🧹 已清理 ${cleanedCount} 条过期的已阅记录 (${READ_EXPIRE_DAYS}天前)`);
    }

    return cleanedCount;
}

/**
 * 获取已阅记录数量
 * @returns {number}
 */
function getReadPostsCount() {
    return Object.keys(readPosts).length;
}

/**
 * 应用已阅样式到帖子行
 * @param {HTMLElement} tr - 帖子行元素
 * @param {string} postId - 帖子ID
 */
function applyReadStyle(tr, postId) {
    if (!isPostRead(postId)) return;

    const titleLink = tr.querySelector("td.tal h3 a");
    if (!titleLink) return;

    // 添加已阅类名
    tr.classList.add('post-read');
    titleLink.classList.add('read-title');

    // 添加已阅标记
    if (!titleLink.querySelector('.read-mark')) {
        const mark = document.createElement('span');
        mark.className = 'read-mark';
        mark.textContent = ' ✓';
        mark.title = '已阅';
        titleLink.appendChild(mark);
    }
}

/**
 * 清除所有已阅记录
 */
function clearAllReadPosts() {
    if (confirm('确定要清除所有已阅记录吗？')) {
        readPosts = {};
        saveReadPosts(readPosts);
        // 刷新页面以更新显示
        location.reload();
    }
}

/**
 * 批量标记当前页所有帖子为已阅
 */
function markAllPostsAsRead() {
    let count = 0;
    const now = Date.now();
    document.querySelectorAll("#tbody > tr").forEach(tr => {
        // 跳过已被过滤隐藏的帖子
        if (tr.style.display === 'none') {
            return;
        }

        const titleLink = tr.querySelector("td.tal h3 a");
        const postId = getPostId(titleLink);
        if (postId && !isPostRead(postId)) {
            readPosts[postId] = now;
            applyReadStyle(tr, postId);
            count++;
        }
    });
    if (count > 0) {
        saveReadPosts(readPosts);
        showToast(`已标记 ${count} 个帖子为已阅`, 'success');
    }
}

// ================================================================= //
//                    ★ 图片加载超时控制（带自动重试）★
// ================================================================= //

/**
 * 带超时控制和自动重试的图片加载
 * @param {HTMLImageElement} img - 图片元素
 * @param {string} src - 图片源地址
 * @param {HTMLAnchorElement} parentLink - 父级链接元素
 * @param {number} retryCount - 当前重试次数
 */
function loadImageWithTimeout(img, src, parentLink, retryCount = 0) {
    let timeoutId;
    let isCompleted = false;

    const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
    };

    const onSuccess = () => {
        if (isCompleted) return;
        isCompleted = true;
        cleanup();
        img.style.opacity = '1';
    };

    const onError = (reason = '加载失败') => {
        if (isCompleted) return;
        isCompleted = true;
        cleanup();

        // 如果还有重试次数，自动重试
        if (retryCount < MAX_RETRY_COUNT) {
            console.log(`🔄 图片加载失败，自动重试 (${retryCount + 1}/${MAX_RETRY_COUNT}):`, src);
            setTimeout(() => {
                img.src = ''; // 重置
                loadImageWithTimeout(img, src, parentLink, retryCount + 1);
            }, 1000); // 延迟1秒后重试
            return;
        }

        // 重试次数用完，显示占位符
        img.src = '';

        if (parentLink && parentLink.parentElement) {
            replaceWithPlaceholder(parentLink, src, reason, retryCount);
        }
    };

    // 标准事件监听
    img.addEventListener('load', onSuccess, { once: true });
    img.addEventListener('error', () => onError('加载失败 ❌'), { once: true });

    // 超时控制
    timeoutId = setTimeout(() => onError('加载超时 ⏱️'), IMAGE_LOAD_TIMEOUT);

    // 设置src触发加载
    img.src = src;
}

/**
 * 创建占位符替换失败的图片
 * @param {HTMLAnchorElement} link - 包含图片的链接元素
 * @param {string} originalSrc - 原始图片地址
 * @param {string} reason - 失败原因
 * @param {number} retryCount - 已重试次数
 */
function replaceWithPlaceholder(link, originalSrc, reason, retryCount) {
    const pageUrl = link.href;

    const placeholder = document.createElement('div');
    placeholder.className = 'img-placeholder';
    placeholder.dataset.src = originalSrc; // 保存原始地址
    placeholder.dataset.pageUrl = pageUrl;

    placeholder.innerHTML = `
        <div class="placeholder-content">
            <span class="placeholder-icon">🖼️</span>
            <span class="placeholder-text">${reason}</span>
            ${retryCount > 0 ? `<span class="retry-info">已重试 ${retryCount} 次</span>` : ''}
            <button class="reload-btn" title="重新加载图片">
                <span class="reload-icon">🔄</span>
                <span class="reload-text">重试</span>
            </button>
        </div>
    `;

    const reloadBtn = placeholder.querySelector('.reload-btn');
    reloadBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        retryImage(placeholder);
    };

    const parent = link.parentElement;
    if (parent) {
        parent.replaceChild(placeholder, link);
        updateRetryButton(parent); // 更新帖子的重试按钮状态
    }
}

/**
 * 重试单个占位符图片
 * @param {HTMLElement} placeholder - 占位符元素
 */
function retryImage(placeholder) {
    const originalSrc = placeholder.dataset.src;
    const pageUrl = placeholder.dataset.pageUrl;

    if (!originalSrc || !pageUrl) return;

    const newLink = document.createElement('a');
    newLink.href = pageUrl;
    newLink.target = '_blank';

    const newImg = document.createElement('img');
    newImg.dataset.src = originalSrc;
    newImg.style.opacity = '0.3';

    newLink.appendChild(newImg);

    const parent = placeholder.parentElement;
    if (parent) {
        parent.replaceChild(newLink, placeholder);
        loadImageWithTimeout(newImg, originalSrc, newLink, 0); // 从0开始重新计数
        updateRetryButton(parent); // 更新帖子的重试按钮状态
    }
}

/**
 * 更新帖子的一键重试按钮状态
 * @param {HTMLElement} container - 容器元素
 */
function updateRetryButton(container) {
    const wrapper = container.closest('.preview-wrapper');
    if (!wrapper) return;

    const retryBtn = wrapper.parentElement.querySelector('.post-retry-btn');
    if (!retryBtn) return;

    const failedCount = wrapper.querySelectorAll('.img-placeholder').length;
    const countSpan = retryBtn.querySelector('.failed-count');

    if (failedCount > 0) {
        retryBtn.style.display = 'inline-flex';
        if (countSpan) countSpan.textContent = failedCount;
    } else {
        retryBtn.style.display = 'none';
    }
}

/**
 * 一键重试帖子内所有失败的图片
 * @param {HTMLElement} wrapper - 预览容器
 */
function retryAllInPost(wrapper) {
    const placeholders = wrapper.querySelectorAll('.img-placeholder');
    placeholders.forEach(placeholder => {
        retryImage(placeholder);
    });
}

// ================================================================= //
//                    ★ 帖子加载队列管理器 ★
// ================================================================= //

class PostLoadQueue {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.loadingPosts = new Map();
        this.queue = [];
    }

    requestLoad(postId, tr) {
        if (this.loadingPosts.has(postId) || this.queue.some(item => item.postId === postId)) {
            return;
        }

        if (this.loadingPosts.size < this.maxConcurrent) {
            this.startLoad(postId, tr);
        } else {
            this.queue.push({ postId, tr });
            const wrap = tr.querySelector('.preview-wrapper');
            if (wrap) wrap.dataset.status = 'queued';
        }
    }

    startLoad(postId, tr) {
        this.loadingPosts.set(postId, { tr, startTime: Date.now() });
        const wrap = tr.querySelector('.preview-wrapper');
        if (wrap) wrap.dataset.status = 'loading';

        fetchAndPreparePreviews(tr, postId);
    }

    finishLoad(postId) {
        if (!this.loadingPosts.has(postId)) return;

        this.loadingPosts.delete(postId);

        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.startLoad(next.postId, next.tr);
        }
    }

    getStatus() {
        return {
            loading: this.loadingPosts.size,
            queued: this.queue.length,
        };
    }
}

const postQueue = new PostLoadQueue(MAX_CONCURRENT_POSTS);

// ================================================================= //
//                       ★ 列表页主函数 ★
// ================================================================= //

function initListPage() {
    excludeKeywords = getExcludeKeywords();
    isFilterEnabled = getFilterEnabled();
    readPosts = getReadPosts();

    // 自动清理过期的已阅记录
    cleanExpiredReadPosts();

    injectStyles();

    imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.dataset.src;
                if (src) {
                    const parentLink = img.closest('a');
                    loadImageWithTimeout(img, src, parentLink);
                    img.removeAttribute('data-src');
                }
                observer.unobserve(img);
            }
        });
    }, { rootMargin: '200px 0px', threshold: 0.01 });

    sentinelObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                loadNextBatch(entry.target);
            }
        });
    }, { rootMargin: '100px 0px' });

    cleanupNonDataRows();

    document.querySelectorAll("#tbody > tr").forEach(processPostRow);

    observeTableForNewRows();

    buildPanel();
}

/**
 * 集中处理单个帖子行的函数
 */
function processPostRow(tr) {
    cleanRow(tr);
    applyFilterToRow(tr);

    if (tr.style.display === 'none') {
        return;
    }

    // 获取帖子ID并应用已阅样式
    const titleLink = tr.querySelector("td.tal h3 a");
    const postId = getPostId(titleLink);

    // 应用已阅样式
    if (postId) {
        applyReadStyle(tr, postId);

        // 添加点击事件监听，标记为已阅
        if (titleLink && !titleLink.dataset.readListenerAdded) {
            titleLink.addEventListener('click', () => {
                markPostAsRead(postId);
                applyReadStyle(tr, postId);
            });
            titleLink.dataset.readListenerAdded = 'true';
        }
    }

    // 如果帖子已阅，跳过预览图加载
    if (isPostRead(postId)) {
        return;
    }

    preparePreviewContainer(tr);

    const item = tr.querySelector("td.tal");
    if (!item) return;

    const wrap = item.querySelector(".preview-wrapper");
    if (!wrap) return;

    const queueId = `post_${Math.random().toString(36).substr(2, 9)}`;
    wrap.dataset.postId = queueId;

    postQueue.requestLoad(queueId, tr);
}

// ================================================================= //
//                       ★ 列表页功能函数 ★
// ================================================================= //

function cleanupNonDataRows() {
    const observer = new MutationObserver((mutationsList, obs) => {
        const firstTbody = document.querySelector("#ajaxtable > tbody:first-of-type");
        if (firstTbody) {
            const rowsToHide = firstTbody.querySelectorAll(":scope > tr");
            rowsToHide.forEach(row => { row.style.display = 'none'; });
            obs.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function cleanRow(tr) {
    Array.from(tr.children).forEach((td, i) => { if (i !== 1) td.style.display = 'none'; });
}

function applyFilterToRow(tr) {
    if (!isFilterEnabled) {
        tr.style.display = "";
        return;
    }
    const titleDom = tr.querySelector("td.tal h3 a");
    if (!titleDom) return;
    const titleText = titleDom.textContent || "";

    try {
        tr.style.display = excludeKeywords.some(kw => kw && new RegExp(kw, 'i').test(titleText)) ? "none" : "";
    } catch (e) {
        console.error("无效的正则表达式:", e.message);
        tr.style.display = "";
    }
}

function loadNextBatch(sentinel) {
    const wrap = sentinel.parentElement;
    if (!wrap) return;

    const postId = wrap.dataset.postId;
    const data = previewDataStore.get(postId);

    if (!data || data.loaded >= data.total) {
        sentinel.remove();
        return;
    }

    const { pageUrl, allImgs } = data;
    const nextBatchData = allImgs.slice(data.loaded, data.loaded + BATCH_SIZE);
    data.loaded += nextBatchData.length;

    const fragment = document.createDocumentFragment();
    nextBatchData.forEach(imgDataSrc => {
        const a = document.createElement('a');
        a.href = pageUrl;
        a.target = '_blank';
        const img = document.createElement('img');
        img.dataset.src = imgDataSrc;
        a.appendChild(img);
        fragment.appendChild(a);
        imageObserver.observe(img);
    });

    wrap.insertBefore(fragment, sentinel);

    if (data.loaded >= data.total) {
        sentinel.remove();
    }
}

function fetchAndPreparePreviews(tr, postId) {
    const item = tr.querySelector("td.tal");
    if (!item) {
        postQueue.finishLoad(postId);
        return;
    }
    const aDom = item.querySelector("h3 > a");
    if (!aDom) {
        postQueue.finishLoad(postId);
        return;
    }

    const pageUrl = aDom.href;
    if (!pageUrl) {
        postQueue.finishLoad(postId);
        return;
    }
    if (item.dataset.previewLoaded === 'true') {
        postQueue.finishLoad(postId);
        return;
    }

    item.dataset.previewLoaded = 'true';
    const wrap = item.querySelector(".preview-wrapper");

    fetch(pageUrl)
        .then(res => res.ok ? res.text() : Promise.reject(`HTTP error! status: ${res.status}`))
        .then(txt => {
            const dom = document.createElement("div");
            dom.innerHTML = txt;
            const allImgData = Array.from(dom.querySelectorAll("img[ess-data]"))
                .map(img => img.getAttribute("ess-data"));

            const totalImgs = allImgData.length;

            if (totalImgs === 0 || !wrap) {
                if (wrap) wrap.remove();
                postQueue.finishLoad(postId);
                return;
            }

            previewDataStore.set(postId, {
                pageUrl,
                allImgs: allImgData,
                total: totalImgs,
                loaded: 0
            });

            const sentinel = document.createElement('div');
            sentinel.className = 'preview-sentinel';
            wrap.appendChild(sentinel);
            sentinelObserver.observe(sentinel);

            // 添加一键重试按钮
            addRetryButton(item, wrap);

            // ✅ 获取到图片列表后立即释放队列
            wrap.removeAttribute('data-status');
            postQueue.finishLoad(postId);

        })
        .catch(error => {
            console.error('获取帖子失败:', pageUrl, error);
            if (wrap) wrap.remove();
            postQueue.finishLoad(postId);
        });
}

/**
 * 为帖子添加一键重试按钮
 * @param {HTMLElement} item - 帖子容器
 * @param {HTMLElement} wrap - 预览容器
 */
function addRetryButton(item, wrap) {
    const h3 = item.querySelector("h3");
    if (!h3 || h3.querySelector('.post-retry-btn')) return;

    const retryBtn = document.createElement('button');
    retryBtn.className = 'post-retry-btn';
    retryBtn.style.display = 'none'; // 初始隐藏
    retryBtn.innerHTML = `
        <span class="retry-icon">🔄</span>
        <span class="retry-text">重试失败图片 (<span class="failed-count">0</span>)</span>
    `;

    retryBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        retryAllInPost(wrap);
    };

    h3.appendChild(retryBtn);
}

function preparePreviewContainer(tr) {
    const item = tr.querySelector("td.tal");
    if (!item || item.querySelector(".preview-wrapper")) return;
    const wrap = document.createElement("div");
    wrap.className = "preview-wrapper";
    const h3 = item.querySelector("h3");
    if (h3) {
        h3.insertAdjacentElement("afterend", wrap);
    }
}

function observeTableForNewRows() {
    const mainTbody = document.querySelector("#tbody");
    if (!mainTbody) return;
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1 && node.matches("tr")) {
                    processPostRow(node);
                }
            }
        }
    });
    observer.observe(mainTbody, { childList: true });
}

function applyFilterToAll() {
    document.querySelectorAll("#tbody > tr").forEach(tr => {
        applyFilterToRow(tr);
        if (tr.style.display !== 'none' && !tr.querySelector('.preview-wrapper')) {
            processPostRow(tr);
        }
    });
}

function buildPanel() {
    const panel = document.createElement("div");
    panel.className = "filter-panel";
    panel.innerHTML = `
        <header>
            <h3>
                <span>显示优化设置</span>
                <div class="panel-controls">
                    <label class="switch">
                        <input type="checkbox" id="filter-toggle">
                        <span class="slider"></span>
                    </label>
                    <button class="minimize-btn" title="最小化">－</button>
                </div>
            </h3>
        </header>
        <section id="read-mark-section">
            <div class="read-mark-controls">
                <div class="read-stats">
                    <span class="stat-label">已阅帖子:</span>
                    <span class="stat-value" id="read-count">0</span>
                </div>
                <div class="batch-buttons">
                    <button id="mark-all-btn" class="batch-btn batch-btn-primary" title="标记本页所有帖子为已阅">全部标记</button>
                    <button id="clear-read-btn" class="batch-btn batch-btn-danger" title="清除全部历史已阅记录">清空全部</button>
                </div>
            </div>
        </section>
        <section id="exclude-section">
            <h4 class="exclude">过滤关键词</h4>
            <div id="exclude-kw-list" class="kw-list"></div>
            <div class="input-wrapper">
                <input type="text" id="exclude-kw-input" placeholder="输入正则表达式..."/>
                <button data-type="exclude" class="add-kw-btn">添加</button>
            </div>
        </section>
    `;
    document.body.appendChild(panel);

    const expandBtn = document.createElement("button");
    expandBtn.className = "expand-btn";
    expandBtn.textContent = "⚙️";
    document.body.appendChild(expandBtn);

    const minimizePanel = () => {
        panel.style.display = "none";
        expandBtn.classList.add("show");
        setPanelState("min");
    };
    const maximizePanel = () => {
        panel.style.display = "flex";
        expandBtn.classList.remove("show");
        setPanelState("max");
    };

    panel.querySelector(".minimize-btn").onclick = minimizePanel;
    expandBtn.onclick = maximizePanel;

    if (getPanelState() === "min") {
        minimizePanel();
    } else {
        panel.style.display = 'flex';
    }

    const filterToggle = panel.querySelector("#filter-toggle");
    filterToggle.checked = isFilterEnabled;
    filterToggle.addEventListener("change", () => {
        isFilterEnabled = filterToggle.checked;
        setFilterEnabled(isFilterEnabled);
        applyFilterToAll();
    });

    // 已阅标记功能控制
    const readCountEl = panel.querySelector("#read-count");
    const clearReadBtn = panel.querySelector("#clear-read-btn");
    const markAllBtn = panel.querySelector("#mark-all-btn");

    readCountEl.textContent = getReadPostsCount();

    // 批量操作按钮
    markAllBtn.addEventListener("click", markAllPostsAsRead);
    clearReadBtn.addEventListener("click", clearAllReadPosts);

    // 定期更新已阅计数
    setInterval(() => {
        readCountEl.textContent = getReadPostsCount();
    }, 1000);

    const excludeListDiv = panel.querySelector("#exclude-kw-list");

    const renderKeywords = () => {
        excludeListDiv.innerHTML = "";
        excludeKeywords.forEach((kw, i) => {
            const row = document.createElement("div");
            row.className = "kw";
            row.innerHTML = `<span class="kw-text" title="${kw}">${kw}</span><button data-idx="${i}">✖</button>`;
            row.querySelector("button").onclick = (e) => handleRemoveKeyword(e.target.dataset.idx);
            excludeListDiv.appendChild(row);
        });
    };

    const handleAddKeyword = () => {
        const inputEl = panel.querySelector("#exclude-kw-input");
        const kw = inputEl.value.trim();
        if (kw && !excludeKeywords.includes(kw)) {
            excludeKeywords.push(kw);
            setExcludeKeywords(excludeKeywords);
            renderKeywords();
            applyFilterToAll();
            inputEl.value = "";
        }
    };

    const handleRemoveKeyword = (index) => {
        excludeKeywords.splice(index, 1);
        setExcludeKeywords(excludeKeywords);
        renderKeywords();
        applyFilterToAll();
    };

    panel.querySelector('.add-kw-btn').addEventListener('click', handleAddKeyword);
    panel.querySelector('#exclude-kw-input').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            handleAddKeyword();
        }
    });

    renderKeywords();
}

function injectStyles() {
    const listStyle = document.createElement("style");
    listStyle.innerHTML = `
        #header, #main { max-width: 1500px !important; }
        .preview-wrapper { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; min-height: 50px; position: relative; }
        .preview-wrapper img {
            height: auto; max-height: 200px; cursor: pointer; border-radius: 4px;
            transition: opacity 0.3s ease-in-out;
            background: linear-gradient(90deg, #f0f0f0 0%, #e8e8e8 50%, #f0f0f0 100%);
            background-size: 200% 100%;
            min-width: 50px;
            opacity: 0.3;
        }
        .preview-wrapper img:not([src]),
        .preview-wrapper img[src=""] {
            animation: skeleton 1.5s ease-in-out infinite;
        }
        @keyframes skeleton {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        .preview-wrapper img[src]:not([src=""]) { opacity: 1; }
        .preview-wrapper img:hover { opacity: 0.85; }
        .preview-sentinel { width: 100%; height: 40px; flex-shrink: 0; }

        /* 已阅帖子样式 */
        .post-read {
            opacity: 0.6;
        }
        .read-title {
            color: #999 !important;
            text-decoration: none;
        }
        .read-title:visited {
            color: #999 !important;
        }
        .read-mark {
            color: #4CAF50;
            font-weight: bold;
            margin-left: 4px;
        }

        /* 帖子一键重试按钮 */
        .post-retry-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-left: 8px;
            padding: 4px 10px;
            background: linear-gradient(135deg, #FF6B6B 0%, #EE5A6F 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(238, 90, 111, 0.3);
            font-weight: 500;
        }
        .post-retry-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(238, 90, 111, 0.4);
            background: linear-gradient(135deg, #FF7B7B 0%, #FF6A7F 100%);
        }
        .post-retry-btn:active {
            transform: translateY(0);
        }
        .post-retry-btn .retry-icon {
            font-size: 13px;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        .post-retry-btn .failed-count {
            font-weight: 700;
            background: rgba(255, 255, 255, 0.3);
            padding: 1px 5px;
            border-radius: 3px;
        }

        /* 图片加载占位符样式 */
        .img-placeholder {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 120px;
            height: 200px;
            background: linear-gradient(135deg, #f8f8f8 0%, #ececec 100%);
            border-radius: 4px;
            border: 2px dashed #d0d0d0;
            transition: all 0.3s ease;
        }
        .img-placeholder:hover {
            border-color: #999;
            background: linear-gradient(135deg, #f0f0f0 0%, #e4e4e4 100%);
        }
        .placeholder-content {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            padding: 16px;
            text-align: center;
        }
        .placeholder-icon {
            font-size: 32px;
            opacity: 0.5;
        }
        .placeholder-text {
            font-size: 11px;
            color: #999;
            font-weight: 500;
        }
        .retry-info {
            font-size: 10px;
            color: #F39C12;
            font-weight: 600;
        }
        .reload-btn {
            display: flex;
            align-items: center;
            gap: 4px;
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 6px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
            color: #666;
        }
        .reload-btn:hover {
            background: #4CAF50;
            border-color: #4CAF50;
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(76, 175, 80, 0.3);
        }
        .reload-btn:active {
            transform: translateY(0);
        }
        .reload-icon {
            font-size: 14px;
            transition: transform 0.3s ease;
        }
        .reload-btn:hover .reload-icon {
            transform: rotate(180deg);
        }
        .reload-text {
            font-weight: 500;
        }

        /* 加载状态提示 */
        .preview-wrapper[data-status]::before {
            content: " ";
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .preview-wrapper[data-status="queued"]::before {
            content: "排队中...";
            background: rgba(255, 193, 7, 0.9);
        }
        .preview-wrapper[data-status="loading"]::before {
            content: "获取列表中...";
            background: rgba(76, 175, 80, 0.9);
        }

        /* 面板样式 */
        .filter-panel { position: fixed; top: 80px; right: 20px; background: #fafafa; color: #333; padding: 10px 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); font-size: 13px; z-index: 9999; width: 240px; font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 5px; }
        .filter-panel h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #222; display: flex; justify-content: space-between; align-items: center; }
        .filter-panel h4 { margin: 8px 0 4px 0; font-size: 12px; font-weight: 600; color: #555; border-bottom: 1px solid #eee; padding-bottom: 4px; }
        .filter-panel h4.exclude { color: #c0392b; }
        .filter-panel h4.read-mark { color: #3498db; }
        .panel-controls { display: flex; align-items: center; gap: 8px; }
        .input-wrapper { display: flex; gap: 6px; margin-top: 6px; }
        .filter-panel input[type="text"] { flex: 1; width: auto; margin-top: 0; padding: 5px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; box-sizing: border-box; background: #fff; min-width: 40px; }
        .filter-panel .add-kw-btn { padding: 5px 12px; border: 1px solid #ddd; background: #f0f0f0; color: #333; border-radius: 6px; cursor: pointer; font-size: 12px; transition: background 0.2s; flex-shrink: 0; }
        .filter-panel .add-kw-btn:hover { background: #e0e0e0; }
        .kw-list { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; max-height: 150px; overflow-y: auto; padding-right: 2px; scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .kw-list::-webkit-scrollbar { width: 4px; }
        .kw-list::-webkit-scrollbar-track { background: transparent; }
        .kw-list::-webkit-scrollbar-thumb { background-color: transparent; border-radius: 2px; }
        .kw-list:hover::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.35); }
        .kw { display: flex; justify-content: space-between; align-items: center; background: #fdfdfd; border-radius: 6px; padding: 4px 8px; font-size: 12px; user-select: none; transition: background 0.2s; }
        .kw:hover { background: #f0f0f0; }
        .kw .kw-text { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .kw button { background: none; border: none; font-size: 13px; color: #aaa; cursor: pointer; margin-left: 8px; }
        .kw button:hover { color: #e74c3c; }
        .minimize-btn { background:none; border:none; font-size: 16px; font-weight: bold; cursor:pointer; color:#999; padding: 0 4px; line-height: 1; }
        .minimize-btn:hover { color:#555; }
        .expand-btn { position: fixed; top: 80px; right: 20px; background: #fafafa; color: #333; border-radius: 50%; width: 28px; height: 28px; display: none; align-items: center; justify-content: center; cursor: pointer; z-index: 10000; font-size: 15px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); border: none; }
        .expand-btn.show { display:flex; }
        .switch { position: relative; display: inline-block; width: 34px; height: 20px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: #4CAF50; }
        input:checked + .slider:before { transform: translateX(14px); }

        /* 已阅标记控制区域 */
        .read-mark-controls {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 6px 0;
        }
        .read-stats {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            padding: 4px 8px;
            background: #f5f5f5;
            border-radius: 4px;
        }

        /* 批量操作按钮组 */
        .batch-buttons {
            display: flex;
            gap: 6px;
            width: 100%;
        }
        .batch-btn {
            flex: 1;
            padding: 6px 8px;
            border: none;
            border-radius: 6px;
            font-size: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-weight: 500;
            white-space: nowrap;
        }
        .batch-btn-primary {
            background: #3498db;
            color: white;
        }
        .batch-btn-primary:hover {
            background: #2980b9;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);
        }
        .batch-btn-danger {
            background: #e74c3c;
            color: white;
        }
        .batch-btn-danger:hover {
            background: #c0392b;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(231, 76, 60, 0.3);
        }
        .batch-btn:active {
            transform: translateY(0);
        }

        /* Toast 提示样式 */
        .toast {
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            color: white;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10001;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
            pointer-events: none;
        }
        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .toast-success {
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        }
        .toast-error {
            background: linear-gradient(135deg, #f44336 0%, #da190b 100%);
        }
        .toast-info {
            background: linear-gradient(135deg, #2196F3 0%, #0b7dda 100%);
        }
    `;
    document.head.appendChild(listStyle);
}


// ================================================================= //
//                         ★ 主逻辑判断 ★
// ================================================================= //

if (document.querySelector('#tbody')) {
    initListPage();
}

})();