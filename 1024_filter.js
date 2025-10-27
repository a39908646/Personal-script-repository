// ==UserScript==
// @name         草榴社区显示优化、过滤
// @namespace    http://tampermonkey.net/
// @version      5.7.0
// @description  【正则模式】帖子并发控制 | 分批懒加载 | 所有关键词均作为正则表达式处理 | 极简面板 | 无限滚动
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

// ================================================================= //
//                       ★ 存储配置 ★
// ================================================================= //

const EXCLUDE_KEY = "excludeKeywords";
const INCLUDE_KEY = "includeKeywords";
const PANEL_STATE_KEY = "filterPanelMinimized";
const FILTER_ENABLED_KEY = "filterEnabled";

// --- 存取函数 ---
const getExcludeKeywords = () => GM_getValue(EXCLUDE_KEY, []);
const setExcludeKeywords = (list) => GM_setValue(EXCLUDE_KEY, list);
const getIncludeKeywords = () => GM_getValue(INCLUDE_KEY, []);
const setIncludeKeywords = (list) => GM_setValue(INCLUDE_KEY, list);
const getPanelState = () => GM_getValue(PANEL_STATE_KEY, "max");
const setPanelState = (state) => GM_setValue(PANEL_STATE_KEY, state);
const getFilterEnabled = () => GM_getValue(FILTER_ENABLED_KEY, true);
const setFilterEnabled = (isEnabled) => GM_setValue(FILTER_ENABLED_KEY, isEnabled);

let excludeKeywords, includeKeywords, isFilterEnabled;

// --- 全局数据存储 ---
const previewDataStore = new Map();

// --- 观察者 ---
let imageObserver, sentinelObserver, postObserver;

// ================================================================= //
//                    ★ 帖子加载队列管理器 ★
// ================================================================= //

class PostLoadQueue {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.loadingPosts = new Map(); // postId -> { tr, status }
        this.queue = [];               // 等待队列: { postId, tr }[]
    }

    /**
     * 请求加载一个帖子，如果并发未满则立即加载，否则加入队列。
     * @param {string} postId - 帖子的唯一标识符。
     * @param {HTMLTableRowElement} tr - 帖子对应的 <tr> 元素。
     */
    requestLoad(postId, tr) {
        // 如果已在加载或已在队列中，则忽略
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

    /**
     * 开始加载一个帖子。
     * @param {string} postId - 帖子的唯一标识符。
     * @param {HTMLTableRowElement} tr - 帖子对应的 <tr> 元素。
     */
    startLoad(postId, tr) {
        this.loadingPosts.set(postId, { tr, startTime: Date.now() });
        const wrap = tr.querySelector('.preview-wrapper');
        if (wrap) wrap.dataset.status = 'loading';
        
        // 实际执行加载操作
        fetchAndPreparePreviews(tr, postId);
    }

    /**
     * 标记一个帖子加载完成，并尝试从队列中加载下一个。
     * @param {string} postId - 完成加载的帖子的唯一标识符。
     */
    finishLoad(postId) {
        if (!this.loadingPosts.has(postId)) return;
        
        this.loadingPosts.delete(postId);

        // 如果队列中有等待的帖子，立即开始加载下一个
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            this.startLoad(next.postId, next.tr);
        }
    }

    /**
     * 获取当前队列状态。
     * @returns {{loading: number, queued: number}}
     */
    getStatus() {
        return {
            loading: this.loadingPosts.size,
            queued: this.queue.length,
        };
    }
}

// 初始化帖子加载队列
const postQueue = new PostLoadQueue(MAX_CONCURRENT_POSTS);

// ================================================================= //
//                       ★ 列表页主函数 ★
// ================================================================= //

function initListPage() {
    excludeKeywords = getExcludeKeywords();
    includeKeywords = getIncludeKeywords();
    isFilterEnabled = getFilterEnabled();

    injectStyles();

    // 初始化 IntersectionObservers
    imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.dataset.src;
                if (src) {
                    img.src = src;
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
    
    // --- 核心改动：初始化所有帖子并加入加载队列 ---
    // 不再使用 postObserver 触发，而是在页面加载时为所有帖子排队
    
    cleanupNonDataRows();

    // 处理页面上已有的所有帖子
    document.querySelectorAll("#tbody > tr").forEach(processPostRow);

    // 观察未来通过无限滚动添加的新帖子
    observeTableForNewRows();
    
    buildPanel();
}

/**
 * 集中处理单个帖子行的函数
 * @param {HTMLTableRowElement} tr 
 */
function processPostRow(tr) {
    cleanRow(tr);
    applyFilterToRow(tr);
    
    // 如果帖子被过滤，则不进行后续预览处理
    if (tr.style.display === 'none') {
        return;
    }

    preparePreviewContainer(tr);
    
    // 将帖子加入加载队列
    const item = tr.querySelector("td.tal");
    if (!item) return;
    
    const wrap = item.querySelector(".preview-wrapper");
    if (!wrap) return;

    // 为每个帖子生成一个唯一的ID，用于在队列中跟踪
    const postId = `post_${Math.random().toString(36).substr(2, 9)}`;
    wrap.dataset.postId = postId;
    
    postQueue.requestLoad(postId, tr);
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
        if (includeKeywords.length > 0 && includeKeywords.some(kw => kw && new RegExp(kw, 'i').test(titleText))) {
            tr.style.display = "";
            return;
        }
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
    
    // 如果帖子数据不存在或已全部加载，则移除哨兵并结束
    if (!data || data.loaded >= data.total) {
        sentinel.remove();
        if (data) {
             wrap.removeAttribute('data-status');
             // 确认完成：当哨兵被移除且所有批次都加载完
             if(data.loaded >= data.total) {
                postQueue.finishLoad(postId); 
             }
        }
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
    
    // 如果这是最后一批，同样移除哨兵并结束
    if (data.loaded >= data.total) {
        sentinel.remove();
        wrap.removeAttribute('data-status');
        postQueue.finishLoad(postId);
    }
}

function fetchAndPreparePreviews(tr, postId) {
    const item = tr.querySelector("td.tal");
    if (!item) { postQueue.finishLoad(postId); return; }
    const aDom = item.querySelector("h3 > a");
    if (!aDom) { postQueue.finishLoad(postId); return; }
    
    const pageUrl = aDom.href;
    if (!pageUrl) { postQueue.finishLoad(postId); return; }
    if (item.dataset.previewLoaded === 'true') { postQueue.finishLoad(postId); return; }
    
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
                postQueue.finishLoad(postId); // 没有图片，也算加载完成
                return;
            }
            
            previewDataStore.set(postId, {
                pageUrl,
                allImgs: allImgData,
                total: totalImgs,
                loaded: 0
            });
            
            // 创建哨兵，用于懒加载图片批次
            const sentinel = document.createElement('div');
            sentinel.className = 'preview-sentinel';
            wrap.appendChild(sentinel);
            sentinelObserver.observe(sentinel);

        })
        .catch(error => {
            console.error('Failed to fetch previews:', pageUrl, error);
            if (wrap) wrap.remove();
            postQueue.finishLoad(postId); // 获取失败，也要算加载完成
        });
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
                    // 对通过无限滚动加载的新行执行相同的处理流程
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
        // 如果行被显示出来，但还没有预览容器，则为其创建并加入队列
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
        <div class="load-stats">
            <div class="stat-row">
                <span class="stat-label">加载中:</span>
                <span class="stat-value active" id="stat-loading">0</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">排队中:</span>
                <span class="stat-value" id="stat-queued">0</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">并发上限:</span>
                <span class="stat-value">${MAX_CONCURRENT_POSTS}</span>
            </div>
        </div>
        <section id="include-section">
            <h4 class="include">保留关键词 (优先)</h4>
            <div id="include-kw-list" class="kw-list"></div>
            <div class="input-wrapper">
                <input type="text" id="include-kw-input" placeholder="输入正则表达式..."/>
                <button data-type="include" class="add-kw-btn">添加</button>
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
    
    const includeListDiv = panel.querySelector("#include-kw-list");
    const excludeListDiv = panel.querySelector("#exclude-kw-list");
    
    const renderKeywords = (type) => {
        const [keywords, listDiv] = type === 'include' 
            ? [includeKeywords, includeListDiv] 
            : [excludeKeywords, excludeListDiv];
        listDiv.innerHTML = "";
        keywords.forEach((kw, i) => {
            const row = document.createElement("div");
            row.className = "kw";
            row.innerHTML = `<span class="kw-text" title="${kw}">${kw}</span><button data-type="${type}" data-idx="${i}">✖</button>`;
            row.querySelector("button").onclick = (e) => handleRemoveKeyword(e.target.dataset.type, e.target.dataset.idx);
            listDiv.appendChild(row);
        });
    };
    
    const handleAddKeyword = (type) => {
        const [inputEl, keywords, setter] = type === 'include' 
            ? [panel.querySelector("#include-kw-input"), includeKeywords, setIncludeKeywords] 
            : [panel.querySelector("#exclude-kw-input"), excludeKeywords, setExcludeKeywords];
        const kw = inputEl.value.trim();
        if (kw && !keywords.includes(kw)) {
            keywords.push(kw);
            setter(keywords);
            renderKeywords(type);
            applyFilterToAll();
            inputEl.value = "";
        }
    };
    
    const handleRemoveKeyword = (type, index) => {
        const [keywords, setter] = type === 'include' 
            ? [includeKeywords, setIncludeKeywords] 
            : [excludeKeywords, setExcludeKeywords];
        keywords.splice(index, 1);
        setter(keywords);
        renderKeywords(type);
        applyFilterToAll();
    };
    
    panel.querySelectorAll('.add-kw-btn').forEach(btn => btn.addEventListener('click', (e) => handleAddKeyword(e.target.dataset.type)));
    panel.querySelectorAll('input[type="text"]').forEach(input => input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            const type = e.target.id.includes('include') ? 'include' : 'exclude';
            handleAddKeyword(type);
        }
    }));
    
    renderKeywords('include');
    renderKeywords('exclude');
    
    // 定时更新加载统计
    setInterval(() => {
        const status = postQueue.getStatus();
        const loadingEl = document.getElementById('stat-loading');
        const queuedEl = document.getElementById('stat-queued');
        if (loadingEl) loadingEl.textContent = status.loading;
        if (queuedEl) queuedEl.textContent = status.queued;
    }, 500);
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
            background: rgba(255, 193, 7, 0.9); /* Amber */
        }
        .preview-wrapper[data-status="loading"]::before {
            content: "加载中...";
            background: rgba(76, 175, 80, 0.9); /* Green */
        }

        /* 面板样式 */
        .filter-panel { position: fixed; top: 80px; right: 20px; background: #fafafa; color: #333; padding: 10px 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); font-size: 13px; z-index: 9999; width: 240px; font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 5px; }
        .filter-panel h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #222; display: flex; justify-content: space-between; align-items: center; }
        .filter-panel h4 { margin: 8px 0 4px 0; font-size: 12px; font-weight: 600; color: #555; border-bottom: 1px solid #eee; padding-bottom: 4px; }
        .filter-panel h4.include { color: #27ae60; }
        .filter-panel h4.exclude { color: #c0392b; }
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
        
        /* 加载统计 */
        .load-stats { font-size: 11px; color: #666; padding: 6px 8px; background: #f5f5f5; border-radius: 4px; text-align: center; margin-top: 4px; line-height: 1.4; }
        .load-stats .stat-row { display: flex; justify-content: space-between; margin: 2px 0; }
        .load-stats .stat-label { color: #999; }
        .load-stats .stat-value { font-weight: 600; color: #333; }
        .load-stats .stat-value.active { color: #4CAF50; }
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