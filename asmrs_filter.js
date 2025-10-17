// ==UserScript==
// @name         ASMRS.live 紧凑列表 & 过滤器 (v3.2 滚动优化)
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  将 asmrs.live 页面重排为无图、紧凑的纯列表视图，兼容无限滚动，过滤器面板的关键字列表可独立滚动。
// @author       You
// @match        https://asmrs.live/movies*
// @match        https://asmrs.live/search*
// @match        https://asmrs.live/tags*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=asmrs.live
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- 全局变量和状态 ---
    let filterEnabled = true;
    let keywords = [];
    let listContainer = null;
    let isInitialized = false;

    // --- 样式注入 ---
    function injectStyles() {
        GM_addStyle(`
            /* 强制隐藏原始的瀑布流容器 */
            .waterfall {
                display: none !important;
            }

            /* --- 紧凑列表视图样式 --- */
            #compact-list-container { width: 100%; padding: 0; margin: 0; list-style-type: none; }
            #compact-list-container li { border-bottom: 1px solid #eee; }
            #compact-list-container li:hover { background-color: #f9f9f9; }
            #compact-list-container li a { display: block; padding: 12px 10px; text-decoration: none; color: #333; }
            #compact-list-container li .title { font-size: 16px; line-height: 1.5; font-weight: 500; }

            /* --- 过滤器面板样式 --- */
            #filter-panel {
                position: fixed; top: 100px; right: 20px; background: #fff; border-radius: 8px; z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            }
            #filter-panel.expanded { width: 300px; }
            #filter-panel.minimized { width: 44px; height: 44px; overflow: hidden; }
            #filter-header {
                background: #4a5568; color: white; cursor: pointer; display: flex; align-items: center; user-select: none;
            }
            #filter-panel.expanded #filter-header { padding: 10px 15px; border-radius: 8px 8px 0 0; justify-content: space-between; }
            #filter-panel.minimized #filter-header { width: 44px; height: 44px; border-radius: 8px; justify-content: center; }
            #filter-title { font-weight: bold; font-size: 14px; }
            #filter-panel.minimized #filter-title { display: none; }
            #toggle-btn { background: none; border: none; color: white; cursor: pointer; font-size: 24px; line-height: 1; padding: 0 5px; }

            /* --- 面板内容区样式 (核心改动) --- */
            #filter-content {
                padding: 15px;
                display: flex;
                flex-direction: column;
                max-height: 60vh; /* 设定整个内容区的最大高度 */
            }
            #filter-panel.minimized #filter-content { display: none; }

            #keyword-input { width: 100%; padding: 8px; border: 1px solid #cbd5e0; border-radius: 4px; box-sizing: border-box; }
            .filter-row { display: flex; gap: 8px; margin-top: 10px; }
            .filter-btn {
                flex-grow: 1; background: #718096; color: white; border: none; padding: 8px 12px; border-radius: 4px;
                cursor: pointer; font-size: 13px; transition: background-color 0.2s;
            }
            .filter-btn:hover { background: #4a5568; }
            .filter-btn.disabled { background: #a0aec0; }

            /* --- 关键字列表样式 (核心改动) --- */
            #keyword-list {
                flex-grow: 1; /* 占据剩余空间 */
                overflow-y: auto; /* 仅自身滚动 */
                margin: 15px 0; /* 上下边距 */
                min-height: 50px; /* 保证列表为空时也有一定高度 */
                padding-right: 5px; /* 为滚动条留出空间 */
            }
            #keyword-list .keyword-item {
                display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 5px;
                background: #edf2f7; border-radius: 4px; font-size: 14px;
            }
            #keyword-list .delete-keyword-btn {
                background: #e53e3e; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;
            }
            #keyword-list .delete-keyword-btn:hover { background: #c53030; }

            .filter-stats { padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #4a5568; flex-shrink: 0; /* 防止被压缩 */ }
            .filter-stats div { margin-bottom: 5px; }
        `);
    }

    // --- 核心处理逻辑 ---
    function processNodes(rootElement) {
        if (!listContainer) return;

        const cards = rootElement.querySelectorAll('.card.nopadding:not([data-processed])');
        if (cards.length === 0) return;

        let itemsAdded = false;
        cards.forEach(card => {
            card.dataset.processed = 'true';
            const linkEl = card.querySelector('a[href^="/movie/"]');
            const titleEl = card.querySelector('h2');
            if (linkEl && titleEl) {
                const href = linkEl.href;
                const title = titleEl.textContent.trim();
                const listItem = document.createElement('li');
                listItem.dataset.title = title.toLowerCase();
                listItem.innerHTML = `<a href="${href}" target="_blank"><span class="title">${title}</span></a>`;
                listContainer.appendChild(listItem);
                itemsAdded = true;
            }
        });
        if (itemsAdded) {
            applyFilter();
        }
    }

    // --- 初始化布局和处理初始内容 ---
    function initializeLayout() {
        const mainContainer = document.querySelector('.layui-col-md12');
        const waterfall = document.querySelector('.waterfall');
        if (mainContainer && waterfall) {
            isInitialized = true;
            listContainer = document.createElement('ul');
            listContainer.id = 'compact-list-container';
            mainContainer.insertBefore(listContainer, waterfall);
            processNodes(document.body);
            return true;
        }
        return false;
    }

    // --- 过滤器相关函数 (未修改) ---
    function createFilterPanel() { /* ... */ }
    function bindPanelEvents() { /* ... */ }
    function addKeyword() { /* ... */ }
    function deleteKeyword(keywordToDelete) { /* ... */ }
    function updateKeywordList() { /* ... */ }
    function updateFilterButton() { /* ... */ }
    function saveSettings() { /* ... */ }
    function loadSettings() { /* ... */ }
    function applyFilter() { /* ... */ }
    function updateStats(total, filtered) { /* ... */ }

    // --- 将省略的函数代码粘贴到这里 ---
    function createFilterPanel() {if (document.getElementById('filter-panel')) return;const panel = document.createElement('div');panel.id = 'filter-panel';panel.className = 'minimized';panel.innerHTML = `<div id="filter-header"><span id="filter-title">列表过滤器</span><button id="toggle-btn">≡</button></div><div id="filter-content"><input type="text" id="keyword-input" placeholder="输入关键字后按回车添加..." /><div class="filter-row"><button id="add-keyword-btn" class="filter-btn">添加</button><button id="filter-enable" class="filter-btn">启用过滤</button></div><div id="keyword-list"></div><div class="filter-stats"><div>总数: <span id="total-count">0</span></div><div>已过滤: <span id="filtered-count">0</span></div><div>显示中: <span id="visible-count">0</span></div></div></div>`;document.body.appendChild(panel);bindPanelEvents();loadSettings();}
    function bindPanelEvents() {const panel = document.getElementById('filter-panel');const header = document.getElementById('filter-header');const toggleBtn = document.getElementById('toggle-btn');header.onclick = () => {const isMinimized = panel.classList.toggle('minimized');panel.classList.toggle('expanded', !isMinimized);toggleBtn.textContent = isMinimized ? '≡' : '×';};document.getElementById('filter-enable').onclick = () => {filterEnabled = !filterEnabled;saveSettings();updateFilterButton();applyFilter();};document.getElementById('add-keyword-btn').onclick = addKeyword;document.getElementById('keyword-input').onkeypress = (e) => {if (e.key === 'Enter') { e.preventDefault(); addKeyword(); }};}
    function addKeyword() {const input = document.getElementById('keyword-input');const keyword = input.value.trim().toLowerCase();if (keyword && !keywords.includes(keyword)) {keywords.push(keyword);input.value = '';saveSettings();updateKeywordList();applyFilter();}}
    function deleteKeyword(keywordToDelete) {keywords = keywords.filter(k => k !== keywordToDelete);saveSettings();updateKeywordList();applyFilter();}
    function updateKeywordList() {const listEl = document.getElementById('keyword-list');listEl.innerHTML = '';keywords.forEach(keyword => {const item = document.createElement('div');item.className = 'keyword-item';item.innerHTML = `<span class="keyword-text">${keyword}</span><button class="delete-keyword-btn">删除</button>`;item.querySelector('.delete-keyword-btn').onclick = () => deleteKeyword(keyword);listEl.appendChild(item);});}
    function updateFilterButton() {const btn = document.getElementById('filter-enable');if (filterEnabled) {btn.textContent = '禁用过滤';btn.classList.remove('disabled');} else {btn.textContent = '启用过滤';btn.classList.add('disabled');}}
    function saveSettings() {GM_setValue('asmrs_filter_enabled', filterEnabled);GM_setValue('asmrs_keywords', JSON.stringify(keywords));}
    function loadSettings() {filterEnabled = GM_getValue('asmrs_filter_enabled', true);keywords = JSON.parse(GM_getValue('asmrs_keywords', '[]'));updateFilterButton();updateKeywordList();}
    function applyFilter() {if (!listContainer) return;const listItems = listContainer.querySelectorAll('li');let filteredCount = 0;listItems.forEach(item => {const title = item.dataset.title;const shouldBeFiltered = filterEnabled && keywords.some(kw => title.includes(kw));item.style.display = shouldBeFiltered ? 'none' : '';if (shouldBeFiltered) filteredCount++;});updateStats(listItems.length, filteredCount);}
    function updateStats(total, filtered) {document.getElementById('total-count').textContent = total;document.getElementById('filtered-count').textContent = filtered;document.getElementById('visible-count').textContent = total - filtered;}
    // ------------------------------------

    // --- 主初始化函数和DOM监控 ---
    function main() {
        injectStyles();
        createFilterPanel();

        const observer = new MutationObserver((mutations) => {
            if (!isInitialized) {
                initializeLayout();
            }
            if (isInitialized) {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            processNodes(node);
                        }
                    });
                });
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        if (document.readyState !== 'loading') {
            if (!isInitialized) initializeLayout();
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                if (!isInitialized) initializeLayout();
            });
        }
    }

    main();

})();