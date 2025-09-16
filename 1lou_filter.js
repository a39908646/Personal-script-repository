// ==UserScript==
// @name         BT之家搜索结果过滤器 (优化版)
// @namespace    https://github.com/a39908646
// @version      1.0.0
// @description  为BT之家搜索结果添加关键词过滤功能，支持正则表达式，性能更优。
// @author       a39908646 (Optimized by Cline)
// @homepage     https://github.com/a39908646/Personal-script-repository
// @updateURL    https://raw.githubusercontent.com/a39908646/Personal-script-repository/main/1lou_filter.js
// @downloadURL  https://raw.githubusercontent.com/a39908646/Personal-script-repository/main/1lou_filter.js
// @match        *://*.1lou.me/*
// @match        *://*.btbtt*.com/*
// @match        *://*.btbtt*.me/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    // --- 状态管理 ---
    const state = {
        includeRegex: [],
        excludeRegex: [],
        showCount: 0,
        hideCount: 0,
        panelVisible: GM_getValue('panelVisible', false),
    };

    // --- 工具函数 ---

    // Debounce函数，用于性能优化
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // 自动消失提示条
    function showTip(message, type = 'info', duration = 2000) {
        const tip = document.getElementById('filterTip');
        if (!tip) return;

        tip.textContent = message;
        tip.className = `filter-tip ${type}`;
        tip.style.opacity = '1';

        clearTimeout(tip._hideTimer);
        tip._hideTimer = setTimeout(() => {
            tip.style.opacity = '0';
        }, duration);
    }

    // --- 核心过滤逻辑 ---

    // 应用过滤器
    function applyFilters() {
        const items = document.querySelectorAll('.subject.break-all');
        let showCount = 0;
        let hideCount = 0;

        items.forEach(item => {
            const text = item.textContent || item.innerText || '';
            const threadItem = item.closest('li.media.thread');
            if (!threadItem) return;

            const shouldInclude = state.includeRegex.length === 0 || state.includeRegex.every(re => re.test(text));
            const shouldExclude = state.excludeRegex.length > 0 && state.excludeRegex.some(re => re.test(text));

            if (shouldInclude && !shouldExclude) {
                threadItem.style.display = '';
                showCount++;
            } else {
                threadItem.style.display = 'none';
                hideCount++;
            }
        });

        state.showCount = showCount;
        state.hideCount = hideCount;
        updateStats();
    }

    // 更新统计数据
    function updateStats() {
        const showCountEl = document.getElementById('showCount');
        const hideCountEl = document.getElementById('hideCount');
        if (showCountEl) showCountEl.textContent = state.showCount;
        if (hideCountEl) hideCountEl.textContent = state.hideCount;
    }

    // --- UI 和事件处理 ---

    // 创建样式
    function createStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #filterPanel { position: fixed; top: 100px; right: -300px; width: 300px; background: white; padding: 15px; border: 1px solid #ccc; border-radius: 5px; z-index: 9999; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: right 0.3s ease-in-out; }
            #toggleFilter { position: absolute; left: -30px; top: 50%; transform: translateY(-50%); width: 30px; height: 60px; background: #4a90e2; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 5px 0 0 5px; font-size: 20px; }
            .panel-header { margin-bottom: 15px; display: flex; align-items: center; position: relative; height: 30px; }
            .panel-title { font-size: 16px; font-weight: bold; }
            .filter-tip { margin-left: 10px; padding: 4px 12px; font-size: 13px; transition: opacity 0.3s ease; opacity: 0; white-space: nowrap; position: absolute; left: 100px; top: 50%; transform: translateY(-50%); }
            .filter-tip.info { color: #4a90e2; }
            .filter-tip.error { color: #e74c3c; }
            .filter-section { margin-bottom: 15px; }
            .filter-section h4 { font-size: 14px; margin-bottom: 5px; color: #333; }
            .filter-textarea { width: 100%; height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px; font-size: 12px; resize: vertical; box-sizing: border-box; }
            .filter-buttons { display: flex; justify-content: space-between; margin-top: 15px; }
            .filter-button { padding: 5px 15px; border: none; border-radius: 4px; cursor: pointer; background: #4a90e2; color: white; font-size: 12px; }
            .filter-button:hover { opacity: 0.9; }
            .filter-button.danger { background: #e74c3c; }
            .stats { text-align: center; color: #666; font-size: 12px; margin-top: 10px; }
            .shortcut-tip { font-size: 11px; color: #666; margin-top: 5px; text-align: center; }
        `;
        document.head.appendChild(style);
    }

    // 创建过滤面板
    function createFilterPanel() {
        const panel = document.createElement('div');
        panel.id = 'filterPanel';

        const includeKeywords = GM_getValue('includeKeywords', '2160p\n4K\nHDR');
        const excludeKeywords = GM_getValue('excludeKeywords', '国语配音\n合集');

        panel.innerHTML = `
            <div id="toggleFilter">◀</div>
            <div class="panel-header">
                <span class="panel-title">结果过滤器</span>
                <div id="filterTip" class="filter-tip"></div>
            </div>
            <div class="filter-section">
                <h4>必须包含 (支持正则, 每行一个)</h4>
                <textarea id="includeKeywords" class="filter-textarea" placeholder="输入必须包含的关键词...">${includeKeywords}</textarea>
            </div>
            <div class="filter-section">
                <h4>必须排除 (支持正则, 每行一个)</h4>
                <textarea id="excludeKeywords" class="filter-textarea" placeholder="输入要排除的关键词...">${excludeKeywords}</textarea>
            </div>
            <div class="filter-buttons">
                <button id="saveFilters" class="filter-button">保存并应用</button>
                <button id="resetFilters" class="filter-button danger">清空</button>
            </div>
            <div class="stats">
                <span>显示: <b id="showCount">0</b> 条</span>
                <span style="margin-left: 10px;">隐藏: <b id="hideCount">0</b> 条</span>
            </div>
            <div class="shortcut-tip">快捷键: Ctrl+Shift+F (开关) | Ctrl+Enter (保存)</div>
        `;
        document.body.appendChild(panel);

        if (state.panelVisible) {
            panel.style.right = '0';
            panel.querySelector('#toggleFilter').innerHTML = '▶';
        }

        addEventListeners();
    }

    // 切换面板可见性
    function togglePanel() {
        const panel = document.getElementById('filterPanel');
        if (!panel) return;
        const toggleBtn = panel.querySelector('#toggleFilter');
        
        state.panelVisible = !state.panelVisible;
        panel.style.right = state.panelVisible ? '0' : '-300px';
        toggleBtn.innerHTML = state.panelVisible ? '▶' : '◀';
        GM_setValue('panelVisible', state.panelVisible);
    }

    // 保存过滤器
    function saveFilters() {
        const includeStr = document.getElementById('includeKeywords').value;
        const excludeStr = document.getElementById('excludeKeywords').value;

        GM_setValue('includeKeywords', includeStr);
        GM_setValue('excludeKeywords', excludeStr);

        const toRegex = (str) => str.split(/[\n\r]+/).filter(k => k.trim()).map(k => {
            try {
                return new RegExp(k.trim(), 'i');
            } catch (e) {
                showTip(`无效正则: ${k}`, 'error');
                return null;
            }
        }).filter(Boolean);

        state.includeRegex = toRegex(includeStr);
        state.excludeRegex = toRegex(excludeStr);

        showTip('过滤规则已保存', 'info');
        applyFilters();
    }

    // 重置过滤器
    function resetFilters() {
        document.getElementById('includeKeywords').value = '';
        document.getElementById('excludeKeywords').value = '';
        saveFilters();
        showTip('已清空所有规则', 'info');
    }

    // 添加事件监听器
    function addEventListeners() {
        document.getElementById('toggleFilter').addEventListener('click', togglePanel);
        document.getElementById('saveFilters').addEventListener('click', saveFilters);
        document.getElementById('resetFilters').addEventListener('click', resetFilters);

        const handleKeydown = (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                saveFilters();
            }
        };
        document.getElementById('includeKeywords').addEventListener('keydown', handleKeydown);
        document.getElementById('excludeKeywords').addEventListener('keydown', handleKeydown);

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
                e.preventDefault();
                togglePanel();
            }
        });
    }

    // --- 初始化 ---
    function initialize() {
        if (!document.querySelector('.threadlist')) {
            // 目标列表不存在，不执行任何操作
            return;
        }

        createStyles();
        createFilterPanel();
        saveFilters(); // 加载时立即应用保存的规则

        const debouncedApplyFilters = debounce(applyFilters, 300);

        const observer = new MutationObserver((mutations) => {
            // 仅当有节点添加或删除时才触发
            if (mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
                debouncedApplyFilters();
            }
        });

        observer.observe(document.querySelector('.threadlist'), {
            childList: true,
            subtree: true
        });
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
