// ==UserScript==
// @name         BT之家搜索结果过滤器Pro
// @homepage    https://github.com/a39908646/Personal-script-repository
// @version      0.8.7
// @description  为BT之家搜索结果添加关键词筛选和屏蔽功能,支持面板折叠和自动加载全部结果
// @author       You
// @match        *://*.1lou.me/*
// @match        *://*.btbtt*.com/*
// @match        *://*.btbtt*.me/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @downloadURL  https://raw.githubusercontent.com/a39908646/Personal-script-repository/main/1lou_filter.js
// @updateURL    https://raw.githubusercontent.com/a39908646/Personal-script-repository/main/1lou_filter.js
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
        .import-export {
            display: flex;
            gap: 5px;
            margin-top: 10px;
        }
        .import-export button {
            flex: 1;
            font-size: 12px;
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
                <button id="loadAllPages" class="filter-button">加载全部</button>
            </div>

            <div class="import-export">
                <button id="exportFilters" class="filter-button">导出配置</button>
                <button id="importFilters" class="filter-button">导入配置</button>
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

    // 添加延迟加载全部页面的功能
    async function loadAllPages() {
        const loadingTip = document.createElement('div');
        loadingTip.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 10px 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            border-radius: 4px;
            z-index: 10000;
        `;
        document.body.appendChild(loadingTip);

        try {
            // 获取最后一页的页码
            const lastPage = document.querySelector('.pagination li:nth-last-child(2) a');
            if (!lastPage) {
                loadingTip.textContent = '无法获取总页数';
                setTimeout(() => loadingTip.remove(), 2000);
                return;
            }

            const totalPages = parseInt(lastPage.textContent);
            const container = document.querySelector('ul.list-unstyled.threadlist');
            if (!container) return;

            // 基础URL部分
            const baseUrl = window.location.href.split('-1.htm')[0];
            const loadedIds = new Set();

            // 记录当前页面帖子ID
            document.querySelectorAll('.subject.break-all a').forEach(link => {
                const threadId = link.href.match(/thread-(\d+)\.htm/)?.[1];
                if (threadId) loadedIds.add(threadId);
            });

            for (let page = 2; page <= totalPages; page++) {
                loadingTip.textContent = `正在加载第 ${page}/${totalPages} 页...`;
                
                const nextPageUrl = `${baseUrl}-${page}.htm`;
                console.log('加载页面:', nextPageUrl);

                // 增加随机延迟 2-5 秒
                await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

                try {
                    // 使用 GM_xmlhttpRequest 代替 fetch
                    const response = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: nextPageUrl,
                            headers: {
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                'Accept-Language': 'zh-CN,zh;q=0.8,en;q=0.6',
                                'Cache-Control': 'no-cache',
                                'Referer': window.location.origin + '/',
                                'User-Agent': window.navigator.userAgent
                            },
                            timeout: 10000,
                            onload: resolve,
                            onerror: reject,
                            ontimeout: reject
                        });
                    });

                    if (response.status !== 200) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');

                    const items = doc.querySelectorAll('li.media.thread');
                    let addedCount = 0;

                    items.forEach(item => {
                        const threadLink = item.querySelector('.subject.break-all a');
                        const threadId = threadLink?.href.match(/thread-(\d+)\.htm/)?.[1];
                        
                        if (threadId && !loadedIds.has(threadId)) {
                            loadedIds.add(threadId);
                            const clone = item.cloneNode(true);
                            container.appendChild(clone);
                            addedCount++;
                        }
                    });

                    console.log(`第 ${page} 页添加了 ${addedCount} 个帖子`);
                    applyFilters();

                } catch (err) {
                    console.error(`加载第 ${page} 页时出错:`, err);
                    loadingTip.textContent = `加载第 ${page} 页失败，正在继续...`;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // 移除分页控件
            const pagination = document.querySelector('.pagination')?.parentNode;
            if (pagination) pagination.remove();

            loadingTip.textContent = '加载完成!';
            setTimeout(() => loadingTip.remove(), 2000);

        } catch (err) {
            console.error('加载过程出错:', err);
            loadingTip.textContent = '加载出错，请重试';
            setTimeout(() => loadingTip.remove(), 2000);
        }
    }

    function addEventListeners(panel) {
        // 面板切换
        const toggleBtn = panel.querySelector('#toggleFilter');
        toggleBtn.addEventListener('click', () => {
            togglePanel();
        });

        // 保存按钮
        document.getElementById('saveFilters').addEventListener('click', saveFilters);

        // 重置按钮
        document.getElementById('resetFilters').addEventListener('click', resetFilters);

        // 导入导出按钮
        document.getElementById('exportFilters').addEventListener('click', exportFilters);
        document.getElementById('importFilters').addEventListener('click', importFilters);

        // 添加加载全部按钮事件
        document.getElementById('loadAllPages').addEventListener('click', loadAllPages);

        // 关键词输入框快捷键 Ctrl+Enter 直接保存并应用
        document.getElementById('includeKeywords').addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') saveFilters();
        });
        document.getElementById('excludeKeywords').addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') saveFilters();
        });

        // 全局快捷键
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+F 切换面板
            if(e.ctrlKey && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                togglePanel();
            }
            // Ctrl+Enter 应用过滤
            if(e.ctrlKey && e.key === 'Enter') {
                // 在textarea内已处理，这里不重复应用
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
        applyFilters();
    }

    function resetFilters() {
        document.getElementById('includeKeywords').value = '';
        document.getElementById('excludeKeywords').value = '';
        saveFilters();
        showTip('已清空所有规则');
    }

    function exportFilters() {
        const config = {
            includeKeywords: document.getElementById('includeKeywords').value,
            excludeKeywords: document.getElementById('excludeKeywords').value
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'bt-filter-config.json';
        a.click();

        URL.revokeObjectURL(url);
        showTip('配置已导出');
    }

    function importFilters() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const config = JSON.parse(event.target.result);
                    document.getElementById('includeKeywords').value = config.includeKeywords || '';
                    document.getElementById('excludeKeywords').value = config.excludeKeywords || '';
                    saveFilters();
                    showTip('配置导入成功');
                } catch (err) {
                    showTip('配置文件格式错误', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function applyFilters() {
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
                    threadItem.style.display = '';
                    showCount++;
                } else {
                    threadItem.style.display = 'none';
                    hideCount++;
                }
            }
        });

        // 更新计数
        document.getElementById('showCount').textContent = showCount;
        document.getElementById('hideCount').textContent = hideCount;
    }

    // 自动应用过滤器当页面加载完成
    function initializeFilter() {
        if(document.querySelector('.threadlist')) {
            createFilterPanel();
            setTimeout(applyFilters, 500);

            // 监听分页变化
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        applyFilters();
                    }
                });
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

})();
