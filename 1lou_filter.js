// ==UserScript==
// @name         BT之家搜索结果过滤器
// @namespace    https://github.com/a39908646
// @version      1.0.0
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
    
    // 核心过滤器模块
    const Filter = {
        // 配置管理
        config: {
            get includeKeywords() {
                return GM_getValue('includeKeywords', '').split(/[\n\s,;，；]+/).filter(k => k.trim());
            },
            get excludeKeywords() {
                return GM_getValue('excludeKeywords', '').split(/[\n\s,;，；]+/).filter(k => k.trim());
            },
            save(include, exclude) {
                GM_setValue('includeKeywords', include);
                GM_setValue('excludeKeywords', exclude);
            },
            isPanelVisible() {
                return GM_getValue('panelVisible', false);
            },
            setPanelVisible(visible) {
                GM_setValue('panelVisible', visible);
            }
        },

        // UI组件
        ui: {
            styles: {
                panel: `
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
                `,
                button: `
                    padding: 5px 15px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    background: #4a90e2;
                    color: white;
                    font-size: 12px;
                `
            },
            
            createPanel() {
                const panel = document.createElement('div');
                panel.id = 'filterPanel';
                panel.innerHTML = this.getPanelHTML();
                document.body.appendChild(panel);
                return panel;
            },

            getPanelHTML() {
                return `
                    <div id="toggleFilter">◀</div>
                    <div class="panel-header">
                        <span class="panel-title">结果过滤器</span>
                        <div id="filterTip"></div>
                    </div>

                    <div class="filter-section">
                        <h4>必须包含以下关键词</h4>
                        <small style="color: #666;">每行一个关键词，支持正则表达式</small>
                        <textarea id="includeKeywords" class="filter-textarea"
                            placeholder="输入必须包含的关键词...">${this.config.includeKeywords.join('\n')}</textarea>
                    </div>

                    <div class="filter-section">
                        <h4>排除以下关键词</h4>
                        <small style="color: #666;">每行一个关键词，支持正则表达式</small>
                        <textarea id="excludeKeywords" class="filter-textarea"
                            placeholder="输入要排除的关键词...">${this.config.excludeKeywords.join('\n')}</textarea>
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
            },

            showTip(message, type = 'info', duration = 1800) {
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
        },

        // 事件处理
        events: {
            init() {
                // 全局快捷键
                document.addEventListener('keydown', e => {
                    if(e.ctrlKey && e.shiftKey && e.key === 'F') {
                        e.preventDefault();
                        this.togglePanel();
                    }
                });

                // 监听DOM变化
                const observer = new MutationObserver(() => Filter.apply());
                const target = document.querySelector('.threadlist');
                if(target) {
                    observer.observe(target, {
                        childList: true,
                        subtree: true
                    });
                }
            },

            togglePanel() {
                const panel = document.getElementById('filterPanel');
                const isVisible = panel.style.right === '0px';
                panel.style.right = isVisible ? '-300px' : '0';
                Filter.config.setPanelVisible(!isVisible);
            }
        },

        // 过滤逻辑
        apply() {
            if (window.pagetualObserver) {
                window.pagetualObserver.disconnect();
            }

            const items = document.querySelectorAll('.subject.break-all');
            let showCount = 0, hideCount = 0;

            items.forEach(item => {
                const threadItem = item.closest('li.media.thread');
                if (!threadItem) return;

                const text = item.textContent.toLowerCase();
                const show = this.shouldShow(text);
                
                threadItem.style.display = show ? '' : 'none';
                show ? showCount++ : hideCount++;
            });

            this.updateStats(showCount, hideCount);

            // 恢复永夜机监听
            setTimeout(() => {
                if (window.pagetualObserver) {
                    window.pagetualObserver.observe(document.querySelector('.threadlist'), {
                        childList: true,
                        subtree: true
                    });
                }
            }, 500);
        },

        shouldShow(text) {
            const includes = this.config.includeKeywords;
            const excludes = this.config.excludeKeywords;

            return (includes.length === 0 || includes.every(k => text.includes(k.toLowerCase()))) &&
                   !excludes.some(k => text.includes(k.toLowerCase()));
        },

        updateStats(show, hide) {
            document.getElementById('showCount').textContent = show;
            document.getElementById('hideCount').textContent = hide;
        },

        // 初始化
        init() {
            const panel = this.ui.createPanel();
            this.events.init();
            
            if(this.config.isPanelVisible()) {
                panel.style.right = '0';
            }

            setTimeout(() => this.apply(), 500);
        }
    };

    // 启动过滤器
    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Filter.init());
    } else {
        Filter.init();
    }
})();
