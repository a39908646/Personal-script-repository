// ==UserScript==
// @name         BT之家搜索结果过滤器
// @namespace    https://github.com/a39908646
// @version      0.9.5
// @description  为BT之家搜索结果添加关键词过滤功能
// @author       a39908646
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

    // 面板内自动消失提示条
    function showTip(message, type = 'info', duration = 1800) {
        let tip = document.getElementById('filterTip');
        if (!tip) {
            const panelHeader = document.querySelector('.panel-header');
            if (!panelHeader) {
                console.error('找不到面板头部');
                return;
            }
            
            tip = document.createElement('div');
            tip.id = 'filterTip';
            panelHeader.appendChild(tip);
        }

        // 设置消息和样式
        tip.textContent = message;
        tip.style.color = type === 'error' ? '#e74c3c' : '#4a90e2';
        
        // 重置动画
        tip.style.display = '';
        tip.style.opacity = '0';
        
        // 强制重排后再显示动画
        void tip.offsetWidth;
        
        requestAnimationFrame(() => {
            tip.style.opacity = '1';
        });

        // 自动隐藏
        clearTimeout(tip._hideTimer);
        tip._hideTimer = setTimeout(() => {
            tip.style.opacity = '0';
            setTimeout(() => {
                tip.style.display = 'none';
            }, 300);
        }, duration);
    }

    // 创建基础样式
    const style = document.createElement('style');
    style.textContent = `
        .panel-header {
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            position: relative;
            height: 30px;  /* 固定高度，防止提示出现时抖动 */
        }
        .panel-title {
            font-size: 16px;
            font-weight: bold;
        }
        #filterTip {
            margin-left: 10px;
            padding: 4px 12px;
            font-size: 13px;
            color: #4a90e2;
            transition: opacity 0.3s ease;
            opacity: 0;
            white-space: nowrap;
            position: absolute;
            left: 100px;  /* 距离标题固定距离 */
            top: 50%;
            transform: translateY(-50%);
        }
        #filterPanel {
            position: fixed;
            top: 100px;
            right: -300px;
            width: 300px;
            background: white;
            padding: 15px;
            border: 1px solid #ccc;
            border-radius: 5px;
            z-index: 9999;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: right 0.3s;
        }
        #toggleFilter {
            position: absolute;
            left: -30px;
            top: 50%;
            transform: translateY(-50%);
            width: 30px;
            height: 60px;
            background: #4a90e2;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            border-radius: 5px 0 0 5px;
            font-size: 20px;
        }
        .filter-section {
            margin-bottom: 15px;
        }
        .filter-section h4 {
            font-size: 14px;
            margin-bottom: 5px;
            color: #333;
        }
        .filter-textarea {
            width: 100%;
            height: 80px;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            font-size: 12px;
            resize: vertical;
        }
        .filter-buttons {
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
        }
        .filter-button {
            padding: 5px 15px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            background: #4a90e2;
            color: white;
            font-size: 12px;
        }
        .filter-button:hover {
            opacity: 0.9;
        }
        .filter-button.danger {
            background: #e74c3c;
        }
        .stats {
            text-align: center;
            color: #666;
            font-size: 12px;
            margin-top: 10px;
        }
        .hidden {
            display: none !important;
        }
        .filtered-item {
            opacity: 0.5;
            text-decoration: line-through;
        }
        .shortcut-tip {
            font-size: 11px;
            color: #666;
            margin-top: 5px;
            text-align: center;
        }
    `;
    document.head.appendChild(style);

    // 创建过滤设置面板
    function createFilterPanel() {
        const panel = document.createElement('div');
        panel.id = 'filterPanel';

        // 获取面板状态
        const isPanelVisible = GM_getValue('panelVisible', false);

        // 获取保存的关键词
        const includeKeywords = GM_getValue('includeKeywords', '2160p\n4K\nHDR\n');
        const excludeKeywords = GM_getValue('excludeKeywords', '国语配音\n合集');

        panel.innerHTML = `
            <div id="toggleFilter">◀</div>
            <div class="panel-header">
                <span class="panel-title">结果过滤器</span>
                <div id="filterTip"></div>
            </div>

            <div class="filter-section">
                <h4>必须包含以下关键词</h4>
                <small style="color: #666;">每行一个关键词，支持正则表达式</small>
                <textarea id="includeKeywords" class="filter-textarea"
                    placeholder="输入必须包含的关键词...">${includeKeywords}</textarea>
            </div>

            <div class="filter-section">
                <h4>排除以下关键词</h4>
                <small style="color: #666;">每行一个关键词，支持正则表达式</small>
                <textarea id="excludeKeywords" class="filter-textarea"
                    placeholder="输入要排除的关键词...">${excludeKeywords}</textarea>
            </div>

            <div class="filter-buttons">
                <button id="saveFilters" class="filter-button">保存并应用</button>
                <button id="resetFilters" class="filter-button danger">清空</button>
            </div>

            <div class="stats">
                <span>显示: <b id="showCount">0</b> 条</span>
                <span style="margin-left: 10px;">隐藏: <b id="hideCount">0</b> 条</span>
            </div>

            <div class="shortcut-tip">
                快捷键: Ctrl+Shift+F (开关面板) | Ctrl+Enter (保存并应用)
            </div>
        `;

        document.body.appendChild(panel);

        // 设置初始状态
        if(isPanelVisible) {
            panel.style.right = '0';
            panel.querySelector('#toggleFilter').innerHTML = '▶';
        }

        // 添加事件监听器
        addEventListeners(panel);
    }

    function addEventListeners(panel) {
        // 面板切换
        const toggleBtn = panel.querySelector('#toggleFilter');
        toggleBtn.addEventListener('click', () => {
            togglePanel();
        });

        // 功能按钮
        document.getElementById('saveFilters').addEventListener('click', saveFilters);
        document.getElementById('resetFilters').addEventListener('click', resetFilters);

        // 快捷键
        document.getElementById('includeKeywords').addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter') saveFilters();
        });
        document.getElementById('excludeKeywords').addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter') saveFilters();
        });

        // 全局快捷键
        document.addEventListener('keydown', e => {
            if(e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                togglePanel();
            }
        });
    }

    function togglePanel() {
        const panel = document.getElementById('filterPanel');
        const toggleBtn = panel.querySelector('#toggleFilter');
        const isPanelVisible = panel.style.right === '0px';

        panel.style.right = isPanelVisible ? '-300px' : '0';
        toggleBtn.innerHTML = isPanelVisible ? '◀' : '▶';
        
        GM_setValue('panelVisible', !isPanelVisible);
    }

    function saveFilters() {
        const includeKeywords = document.getElementById('includeKeywords').value;
        const excludeKeywords = document.getElementById('excludeKeywords').value;
        GM_setValue('includeKeywords', includeKeywords); 
        GM_setValue('excludeKeywords', excludeKeywords);
        showTip('过滤规则已保存');
        applyFilters(); // 直接应用过滤,不刷新页面
    }

    function resetFilters() {
        document.getElementById('includeKeywords').value = '';
        document.getElementById('excludeKeywords').value = '';
        saveFilters();
        showTip('已清空所有规则');
    }

    function applyFilters() {
        // 暂时移除DOM监听器
        if (window.pagetualObserver) {
            window.pagetualObserver.disconnect();
        }

        const includeKeywords = document.getElementById('includeKeywords').value
            .split(/[\n\s,;，；]+/)
            .filter(k => k.trim());
        const excludeKeywords = document.getElementById('excludeKeywords').value
            .split(/[\n\s,;，；]+/)
            .filter(k => k.trim());
        
        let showCount = 0;
        let hideCount = 0;

        // 获取所有主题项
        const items = document.querySelectorAll('.subject.break-all');

        items.forEach(item => {
            // 获取完整的文本内容，包括span中的文本
            const allText = item.textContent || item.innerText || '';
            const normalizedText = allText.toLowerCase();

            // 正向过滤：必须包含所有指定关键词
            const hasAllKeywords = includeKeywords.length === 0 || includeKeywords.every(keyword => {
                const normalizedKeyword = keyword.toLowerCase().trim();
                return normalizedText.includes(normalizedKeyword);
            });

            // 反向过滤：不能包含任何排除关键词
            const hasExcludeKeyword = excludeKeywords.some(keyword => {
                const normalizedKeyword = keyword.toLowerCase().trim();
                return normalizedText.includes(normalizedKeyword);
            });

            // 获取要隐藏的父元素
            const threadItem = item.closest('li.media.thread');
            if (threadItem) {
                if (hasAllKeywords && !hasExcludeKeyword) {
                    threadItem.style.display = ''; // 显示
                    showCount++; 
                } else {
                    threadItem.style.display = 'none'; // 隐藏
                    hideCount++;
                }
            }
        });

        // 更新计数
        document.getElementById('showCount').textContent = showCount;
        document.getElementById('hideCount').textContent = hideCount;

        // 延迟重新绑定DOM监听器
        setTimeout(() => {
            if (window.pagetualObserver) {
                window.pagetualObserver.observe(document.querySelector('.threadlist'), {
                    childList: true,
                    subtree: true
                });
            }
        }, 500);
    }

    // 自动应用过滤器当页面加载完成
    function initializeFilter() {
        if(document.querySelector('.threadlist')) {
            createFilterPanel();
            setTimeout(applyFilters, 500);

            // 监听DOM变化以重新应用过滤
            const observer = new MutationObserver(() => {
                applyFilters();
            });

            observer.observe(document.querySelector('.threadlist'), {
                childList: true,
                subtree: true
            });
        }
    }

    // 页面加载完成后初始化
    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeFilter);
    } else {
        initializeFilter();
    }

    // 在脚本开头检查是否已加载东方永夜机
    function checkPagetual() {
        if (window.pagetual) {
            console.log('检测到东方永夜机已加载');
            // 可以在这里适配一些特殊处理
        }
    }

    // 在初始化时调用
    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkPagetual);
    } else {
        checkPagetual();
    }
})();
