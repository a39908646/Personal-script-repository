// ==UserScript==
// @name         U9A9 正则表达式过滤器 (终极完美版)
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  一个纯粹、强大、设计精美、交互完美的正则表达式过滤器，带总开关并能与无限滚动脚本完美协同工作。
// @author       YourName
// @match        https://u9a9.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const KEYWORDS_STORAGE_KEY = 'u9a9_filter_keywords';
    const FILTER_ENABLED_KEY = 'u9a9_filter_enabled';

    const ICONS = {
        gear: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19.46,12.54,19.46,12.54,19.46,12.54l.05-.08a8.34,8.34,0,0,0,1.3-3.65,1,1,0,0,0-.43-1l-2.07-2.07a1,1,0,0,0-1-.43,8.34,8.34,0,0,0-3.65,1.3l-.08.05-.08,0L12,6.54l-1.44,0-.08,0-.08-.05a8.34,8.34,0,0,0-3.65-1.3,1,1,0,0,0-1,.43L3.62,7.73a1,1,0,0,0-.43,1,8.34,8.34,0,0,0,1.3,3.65l.05.08,0,.08L4.54,14l0,.08-.05.08a8.34,8.34,0,0,0-1.3,3.65,1,1,0,0,0,.43,1l2.07,2.07a1,1,0,0,0,1,.43,8.34,8.34,0,0,0,3.65-1.3l.08-.05.08,0,1.44-2.5,1.44,2.5.08,0,.08.05a8.34,8.34,0,0,0,3.65,1.3,1,1,0,0,0,1-.43l2.07-2.07a1,1,0,0,0,.43-1,8.34,8.34,0,0,0-1.3-3.65l-.05-.08ZM12,16a4,4,0,1,1,4-4A4,4,0,0,1,12,16Z"/></svg>`,
        close: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13.41,12l4.3-4.29a1,1,0,1,0-1.42-1.42L12,10.59,7.71,6.29A1,1,0,0,0,6.29,7.71L10.59,12l-4.3,4.29a1,1,0,0,0,0,1.42,1,1,0,0,0,1.42,0L12,13.41l4.29,4.3a1,1,0,0,0,1.42,0,1,1,0,0,0,0-1.42Z"/></svg>`,
        trash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20,6H16V5a3,3,0,0,0-3-3H11A3,3,0,0,0,8,5V6H4A1,1,0,0,0,4,8H5V19a3,3,0,0,0,3,3h8a3,3,0,0,0,3-3V8h1a1,1,0,0,0,0-2ZM10,5a1,1,0,0,1,1-1h2a1,1,0,0,1,1,1V6H10Zm7,14a1,1,0,0,1-1,1H8a1,1,0,0,1-1-1V8H17Z"/></svg>`,
        plus: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19,11H13V5a1,1,0,0,0-2,0v6H5a1,1,0,0,0,0,2h6v6a1,1,0,0,0,2,0V13h6a1,1,0,0,0,0-2Z"/></svg>`
    };

    // --- 1. 数据管理 ---
    function getKeywords() { return GM_getValue(KEYWORDS_STORAGE_KEY, []); }
    function saveKeywords(keywords) { GM_setValue(KEYWORDS_STORAGE_KEY, keywords); }
    function getFilterEnabled() { return GM_getValue(FILTER_ENABLED_KEY, true); } // 默认开启
    function saveFilterEnabled(enabled) { GM_setValue(FILTER_ENABLED_KEY, enabled); }

    function addKeyword(keyword) {
        if (!keyword || keyword.trim() === '') return false;
        const keywords = getKeywords();
        const newKeyword = keyword.trim();
        if (!keywords.includes(newKeyword)) {
            keywords.push(newKeyword);
            saveKeywords(keywords);
            return true;
        }
        return false;
    }
    function removeKeyword(keyword) {
        let keywords = getKeywords();
        keywords = keywords.filter(k => k !== keyword);
        saveKeywords(keywords);
    }

    // --- 2. 核心过滤功能 ---
    function applyFilterToEntry(entry) {
        if (!entry || !entry.matches || !entry.matches('tr.default')) return;

        if (!getFilterEnabled()) {
            entry.style.display = '';
            return;
        }

        const keywords = getKeywords();
        if (keywords.length === 0) {
            entry.style.display = '';
            return;
        }

        const titleElement = entry.querySelector('td:nth-child(2) a');
        if (titleElement) {
            const title = titleElement.textContent.trim();
            const shouldHide = keywords.some(pattern => {
                try { return new RegExp(pattern, 'i').test(title); } catch (e) { return false; }
            });
            entry.style.display = shouldHide ? 'none' : '';
        }
    }

    function runFullScan() {
        document.querySelectorAll('tr.default').forEach(applyFilterToEntry);
        updateFilterCount();
    }

    function updateFilterCount() {
        const badge = document.getElementById('filter-count-badge');
        if (!badge) return;

        if (!getFilterEnabled()) {
            badge.style.display = 'none';
            return;
        }

        const hiddenEntries = document.querySelectorAll('tr.default[style*="display: none"]');
        const hiddenCount = hiddenEntries.length;
        badge.textContent = hiddenCount;
        badge.style.display = hiddenCount > 0 ? 'flex' : 'none';
    }

    // --- 3. UI ---
    function initUI() {
        const styles = `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            :root {
                --filter-bg: #ffffff; --filter-bg-alt: #f7f9fc;
                --filter-border-color: #e5e7eb; --filter-primary-color: #3b82f6;
                --filter-primary-hover: #2563eb; --filter-danger-hover: #ef4444;
                --filter-text-primary: #1f2937; --filter-text-secondary: #6b7280;
                --filter-disabled-color: #9ca3af;
            }
            #filter-container {
                position: fixed; top: 70px; right: 20px; z-index: 9999;
                font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
                font-weight: 400; font-size: 14px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #filter-container.expanded {
                width: 300px; background: var(--filter-bg); border: 1px solid var(--filter-border-color);
                border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);
            }
            #filter-toggle-view {
                position: relative; width: 48px; height: 48px; background-color: var(--filter-primary-color);
                border-radius: 50%; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                display: flex; align-items: center; justify-content: center; transition: background-color 0.2s;
            }
            #filter-toggle-view:hover { background-color: var(--filter-primary-hover); }
            #filter-toggle-view.filter-disabled { background-color: var(--filter-disabled-color); }
            #filter-toggle-view.filter-disabled:hover { background-color: #6b7280; }
            #filter-toggle-view svg { width: 28px; height: 28px; color: white; }
            #filter-container.expanded #filter-toggle-view { display: none; }
            #filter-container:not(.expanded) #filter-panel-view { display: none; }
            #filter-count-badge {
                position: absolute; top: 0px; right: 0px; background-color: #f87171; color: white;
                border-radius: 50%; min-width: 22px; height: 22px; font-size: 12px; font-weight: 600;
                display: flex; align-items: center; justify-content: center; border: 2px solid var(--filter-bg); display: none;
            }
            #filter-panel-view { padding: 12px 15px; }
            #filter-panel-view h3 {
                margin: 0 0 12px 0; color: var(--filter-text-primary); font-size: 18px; font-weight: 600;
                display: flex; justify-content: space-between; align-items: center;
            }
            .status-indicator {
                width: 10px; height: 10px; border-radius: 50%; margin-left: 8px;
                transition: background-color 0.2s;
            }
            .status-indicator.is-active { background-color: #22c55e; }
            .status-indicator.is-inactive { background-color: var(--filter-disabled-color); }
            #close-panel-btn {
                background: none; border: none; cursor: pointer; padding: 4px; width: 28px; height: 28px;
                color: var(--filter-text-secondary); border-radius: 50%; transition: background-color 0.2s, color 0.2s;
            }
            #close-panel-btn:hover { background-color: #f3f4f6; color: var(--filter-text-primary); }
            #close-panel-btn svg { width: 100%; height: 100%; }
            #keyword-input-area { display: flex; gap: 8px; margin-bottom: 12px; }
            #new-keyword-input {
                flex-grow: 1; padding: 8px 12px; border: 1px solid var(--filter-border-color);
                border-radius: 8px; font-size: 14px; background-color: var(--filter-bg-alt);
                transition: border-color 0.2s, box-shadow 0.2s;
            }
            #new-keyword-input:focus {
                outline: none; border-color: var(--filter-primary-color);
                box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
            }
            #add-keyword-btn {
                flex-shrink: 0; width: 36px; height: 36px; padding: 0; background-color: var(--filter-primary-color);
                color: white; border: none; border-radius: 8px; cursor: pointer; display: flex;
                align-items: center; justify-content: center; transition: background-color 0.2s;
            }
            #add-keyword-btn:hover { background-color: var(--filter-primary-hover); }
            #add-keyword-btn svg { width: 20px; height: 20px; }
            #keyword-list {
                list-style: none; padding: 0; margin: 0; max-height: 220px;
                overflow-y: auto; scrollbar-gutter: stable;
                background-color: var(--filter-bg-alt); border-radius: 8px;
            }
            #keyword-list::-webkit-scrollbar { width: 4px; }
            #keyword-list::-webkit-scrollbar-track { background: transparent; }
            #keyword-list::-webkit-scrollbar-thumb {
                background-color: var(--filter-bg-alt); border-radius: 2px;
                transition: background-color 0.2s ease-out;
            }
            #keyword-list:hover::-webkit-scrollbar-thumb { background-color: #d1d5db; }
            #keyword-list:hover::-webkit-scrollbar-thumb:hover { background-color: #9ca3af; }
            #keyword-list li {
                padding: 4px 8px; margin: 0; display: flex; justify-content: space-between;
                align-items: center; border-bottom: 1px solid var(--filter-border-color);
                transition: background-color 0.2s; border-radius: 6px;
            }
            #keyword-list li:last-child { border-bottom: none; }
            #keyword-list li.newly-added { animation: fadeIn 0.5s ease-out; }
            #keyword-list li:hover { background-color: #e5e7eb; }
            #keyword-list li .keyword-text { color: var(--filter-text-primary); word-break: break-all; }
            .invalid-regex .keyword-text { color: #ef4444; text-decoration: underline wavy #ef4444 1px; }
            #keyword-list li .empty-text { padding: 10px 0; color: var(--filter-text-secondary); justify-content: center; width: 100%; display: flex;}
            #keyword-list li.is-empty-item { border-bottom: none; }
            #keyword-list li.is-empty-item:hover { background-color: transparent; }
            .remove-keyword-btn {
                background: none; border: none; cursor: pointer; flex-shrink: 0; width: 26px; height: 26px;
                padding: 4px; border-radius: 50%; color: var(--filter-text-secondary); margin-left: 8px;
                transition: background-color 0.2s, color 0.2s;
            }
            .remove-keyword-btn:hover { background-color: #fee2e2; color: var(--filter-danger-hover); }
            .remove-keyword-btn svg { width: 100%; height: 100%; }
        `;
        const styleElement = document.createElement('style');
        styleElement.textContent = styles;
        document.head.appendChild(styleElement);

        const container = document.createElement('div');
        container.id = 'filter-container';
        container.innerHTML = `
            <div id="filter-toggle-view" title="中键点击：开关过滤">${ICONS.gear}<span id="filter-count-badge"></span></div>
            <div id="filter-panel-view">
                <h3>
                    <span style="display: flex; align-items: center;">
                        正则过滤器 <span class="status-indicator"></span>
                    </span>
                    <button id="close-panel-btn" title="收起">${ICONS.close}</button>
                </h3>
                <div id="keyword-input-area">
                    <input type="text" id="new-keyword-input" placeholder="添加正则表达式...">
                    <button id="add-keyword-btn" title="添加">${ICONS.plus}</button>
                </div>
                <ul id="keyword-list"></ul>
            </div>
        `;
        document.body.appendChild(container);

        const toggleView = document.getElementById('filter-toggle-view');
        const closePanelBtn = document.getElementById('close-panel-btn');
        const newKeywordInput = document.getElementById('new-keyword-input');
        const addKeywordBtn = document.getElementById('add-keyword-btn');

        toggleView.addEventListener('mousedown', (event) => {
            if (event.button === 0) { // Left click
                container.classList.add('expanded');
                updateUIVisualState();
                updateKeywordListUI();
            } else if (event.button === 1) { // Middle click
                event.preventDefault();
                saveFilterEnabled(!getFilterEnabled());
                updateUIVisualState();
                runFullScan();
            }
        });

        closePanelBtn.addEventListener('click', () => { container.classList.remove('expanded'); });

        const addNewKeywordAction = () => {
            const keywordValue = newKeywordInput.value;
            if (addKeyword(keywordValue)) {
                newKeywordInput.value = '';
                updateKeywordListUI(keywordValue.trim());
                runFullScan();
            }
            newKeywordInput.focus();
        };
        addKeywordBtn.addEventListener('click', addNewKeywordAction);
        newKeywordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addNewKeywordAction(); });
    }

    function updateUIVisualState() {
        const isEnabled = getFilterEnabled();
        const toggleView = document.getElementById('filter-toggle-view');
        const statusIndicator = document.querySelector('.status-indicator');

        if (toggleView) {
            toggleView.classList.toggle('filter-disabled', !isEnabled);
        }
        if (statusIndicator) {
            statusIndicator.classList.toggle('is-active', isEnabled);
            statusIndicator.classList.toggle('is-inactive', !isEnabled);
            statusIndicator.title = isEnabled ? '过滤器已开启' : '过滤器已关闭';
        }
    }

    function updateKeywordListUI(newlyAddedKeyword = null) {
        const listElement = document.getElementById('keyword-list');
        const keywords = getKeywords();
        listElement.innerHTML = '';
        if (keywords.length === 0) {
            listElement.innerHTML = '<li class="is-empty-item"><span class="empty-text">暂无表达式</span></li>';
            return;
        }
        keywords.forEach(keyword => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="keyword-text"></span><button class="remove-keyword-btn" title="删除">${ICONS.trash}</button>`;
            li.querySelector('.keyword-text').textContent = keyword;

            try { new RegExp(keyword); } catch (e) {
                li.classList.add('invalid-regex');
                li.title = `无效的正则表达式：${e.message}`;
            }

            li.querySelector('.remove-keyword-btn').addEventListener('click', () => {
                removeKeyword(keyword);
                updateKeywordListUI();
                runFullScan();
            });
            if (keyword === newlyAddedKeyword) {
                li.classList.add('newly-added');
                setTimeout(() => li.classList.remove('newly-added'), 500);
            }
            listElement.appendChild(li);
        });
    }

    // --- 4. 协同工作 (MutationObserver) ---
    function observeContentChanges() {
        const targetNode = document.querySelector('table.table tbody');
        if (!targetNode) return;

        const observer = new MutationObserver((mutationsList) => {
            if (!getFilterEnabled()) return;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(applyFilterToEntry);
                }
            }
            updateFilterCount();
        });
        observer.observe(targetNode, { childList: true });
    }

    // --- 5. 脚本启动 ---
    window.addEventListener('load', () => {
        initUI();
        runFullScan();
        updateUIVisualState();
        observeContentChanges();
    });
})();