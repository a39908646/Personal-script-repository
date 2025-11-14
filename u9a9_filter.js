// ==UserScript==
// @name         U9A9 正则表达式过滤器 + 预览图 + 已读标记
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  添加已读标记功能，已读帖子置灰不加载预览图，自动清理超过30天的记录
// @author       You
// @match        https://u9a9.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // === 最优先：劫持全局回车事件 ===
    let filterInputIds = new Set();

    window.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.target && filterInputIds.has(e.target.id)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            queueMicrotask(() => {
                const btn = document.getElementById('add-keyword-btn');
                if (btn) btn.click();
            });

            return false;
        }
    }, true);

    window.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.target && filterInputIds.has(e.target.id)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return false;
        }
    }, true);

    // --- 配置 ---
    const SETTINGS_KEY = 'u9a9_filter_settings';
    const READ_POSTS_KEY = 'u9a9_read_posts';
    const IMAGE_LOAD_DELAY_MS = 100;
    const READ_POST_EXPIRE_DAYS = 30;

    const ICONS = {
        gear: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 0 0 2.572-1.065zM12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z"/></svg>`,
    };
    let imageObserver;

    // --- 数据管理 ---
    const dataManager = {
        getSettings: () => GM_getValue(SETTINGS_KEY, { keywords: [], filterEnabled: true }),
        saveSettings: (settings) => GM_setValue(SETTINGS_KEY, settings),

        getKeywords: () => dataManager.getSettings().keywords,
        getFilterEnabled: () => dataManager.getSettings().filterEnabled,

        saveKeywords: (keywords) => {
            const s = dataManager.getSettings();
            s.keywords = keywords;
            dataManager.saveSettings(s);
        },
        saveFilterEnabled: (enabled) => {
            const s = dataManager.getSettings();
            s.filterEnabled = enabled;
            dataManager.saveSettings(s);
        },

        // 已读帖子管理
        getReadPosts: () => {
            const data = GM_getValue(READ_POSTS_KEY, {});
            // 自动清理超过30天的记录
            const now = Date.now();
            const expireTime = READ_POST_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
            let hasExpired = false;

            for (const [hash, timestamp] of Object.entries(data)) {
                if (now - timestamp > expireTime) {
                    delete data[hash];
                    hasExpired = true;
                }
            }

            if (hasExpired) {
                GM_setValue(READ_POSTS_KEY, data);
            }

            return data;
        },

        markAsRead: (hash) => {
            const data = dataManager.getReadPosts();
            data[hash] = Date.now();
            GM_setValue(READ_POSTS_KEY, data);
        },

        markMultipleAsRead: (hashes) => {
            const data = dataManager.getReadPosts();
            const now = Date.now();
            hashes.forEach(hash => {
                data[hash] = now;
            });
            GM_setValue(READ_POSTS_KEY, data);
        },

        isRead: (hash) => {
            return hash in dataManager.getReadPosts();
        },

        clearReadPosts: () => {
            GM_setValue(READ_POSTS_KEY, {});
        }
    };

    function addKeyword(keyword) {
        if (!keyword || keyword.trim() === '') return false;
        const keywords = dataManager.getKeywords();
        const newKeyword = keyword.trim();
        if (!keywords.includes(newKeyword)) {
            keywords.push(newKeyword);
            dataManager.saveKeywords(keywords);
            return true;
        }
        return false;
    }

    function removeKeyword(keyword) {
        const keywords = dataManager.getKeywords().filter(k => k !== keyword);
        dataManager.saveKeywords(keywords);
    }

    function updateKeyword(oldKeyword, newKeyword) {
        if (!newKeyword || newKeyword.trim() === '') return false;
        const trimmedNew = newKeyword.trim();
        if (trimmedNew === oldKeyword) return false;
        const keywords = dataManager.getKeywords();
        if (keywords.includes(trimmedNew)) return false;
        const index = keywords.indexOf(oldKeyword);
        if (index !== -1) {
            keywords[index] = trimmedNew;
            dataManager.saveKeywords(keywords);
            return true;
        }
        return false;
    }

    // --- 提取帖子哈希 ---
    function extractPostHash(entry) {
        const link = entry.querySelector('td:nth-child(2) a');
        if (!link) return null;

        // 从链接中提取唯一标识符 (hash)
        const match = link.href.match(/\/view\/\d+\/([a-f0-9]+)/);
        return match ? match[1] : null;
    }

    // --- 导入/导出逻辑 ---
    function exportSettings() {
        const settings = dataManager.getSettings();
        const jsonString = JSON.stringify(settings, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = `u9a9-filter-settings-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedSettings = JSON.parse(event.target.result);
                    if (Array.isArray(importedSettings.keywords) && typeof importedSettings.filterEnabled === 'boolean') {
                        dataManager.saveSettings({
                            keywords: importedSettings.keywords,
                            filterEnabled: importedSettings.filterEnabled
                        });
                        updateAllUI();
                        runFullScan();
                        alert('配置导入成功！');
                    } else {
                        throw new Error('文件格式不正确。');
                    }
                } catch (err) {
                    alert(`导入失败：${err.message}`);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // --- 过滤逻辑 ---
    function applyFilterToEntry(entry) {
        if (!entry || !entry.matches || !entry.matches('tr.default')) return;

        const hash = extractPostHash(entry);
        const isRead = hash && dataManager.isRead(hash);

        // 应用已读样式
        if (isRead) {
            entry.classList.add('post-read');
        } else {
            entry.classList.remove('post-read');
        }

        // 应用过滤规则
        if (!dataManager.getFilterEnabled()) {
            entry.style.display = '';
            if (!isRead) injectPreviewImages(entry);
            return;
        }

        const titleElement = entry.querySelector('td:nth-child(2) a');
        if (!titleElement) {
            entry.style.display = '';
            if (!isRead) injectPreviewImages(entry);
            return;
        }

        const title = titleElement.textContent.trim();
        const shouldHide = dataManager.getKeywords().some(p => new RegExp(p, 'i').test(title));

        entry.style.display = shouldHide ? 'none' : '';
        // 只有未读且未被隐藏的帖子才加载预览图
        if (!isRead && !shouldHide) {
            injectPreviewImages(entry);
        }
    }

    function runFullScan() {
        document.querySelectorAll('tr.default').forEach(applyFilterToEntry);
        updateFilterCount();
    }

    function updateFilterCount() {
        const badge = document.getElementById('filter-count-badge');
        if (!badge) return;

        if (!dataManager.getFilterEnabled()) {
            badge.style.display = 'none';
            return;
        }

        const hiddenCount = document.querySelectorAll('tr.default[style*="display: none"]').length;
        badge.textContent = hiddenCount;
        badge.style.display = hiddenCount > 0 ? 'flex' : 'none';
    }

    // --- 标记当前页所有可见帖子为已读 ---
    function markCurrentPageAsRead() {
        const entries = document.querySelectorAll('tr.default');
        const hashes = [];

        entries.forEach(entry => {
            // 只标记可见的帖子（未被过滤隐藏的）
            if (entry.style.display !== 'none') {
                const hash = extractPostHash(entry);
                if (hash && !dataManager.isRead(hash)) {
                    hashes.push(hash);
                }
            }
        });

        if (hashes.length > 0) {
            dataManager.markMultipleAsRead(hashes);
            runFullScan();
            alert(`已标记 ${hashes.length} 个帖子为已读`);
        } else {
            alert('当前页面没有未读的可见帖子');
        }
    }

    // --- UI ---
    function initUI() {
        const styles = `
            :root { --filter-bg-main: #ffffff; --filter-bg-panel: #f7f8fa; --filter-bg-input: #ffffff; --filter-primary-color: #3b82f6; --filter-danger-color: #f43f5e; --filter-disabled-color: #9ca3af; --filter-text-primary: #1f2937; --filter-text-secondary: #6b7280; --filter-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.08); --filter-radius: 12px; }
            #filter-container { font-family: "Microsoft YaHei", "微软雅黑", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; position: fixed; top: 70px; right: 20px; z-index: 9999; font-size: 14px; }
            #filter-container.expanded { width: 320px; background: var(--filter-bg-main); border-radius: var(--filter-radius); box-shadow: var(--filter-shadow); }
            #filter-toggle-view { position: relative; width: 48px; height: 48px; background-color: var(--filter-primary-color); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: var(--filter-shadow); }
            #filter-toggle-view.filter-disabled { background-color: var(--filter-disabled-color); }
            #filter-toggle-view svg { width: 28px; height: 28px; color: white; }
            #filter-container.expanded #filter-toggle-view, #filter-container:not(.expanded) #filter-panel-view { display: none; }
            #filter-count-badge { position: absolute; top: 0; right: 0; background-color: var(--filter-danger-color); color: #fff; border-radius: 50%; min-width: 22px; height: 22px; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; border: 2px solid var(--filter-bg-main); }
            #filter-panel-view { padding: 16px; display: flex; flex-direction: column; gap: 16px; max-height: calc(100vh - 100px); overflow-y: auto; scrollbar-gutter: stable; }
            .filter-section { background-color: var(--filter-bg-panel); padding: 12px; border-radius: 10px; }
            .filter-section h3, .filter-section h4 { margin: 0 0 12px 0; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
            .filter-section h3 { font-size: 18px; color: var(--filter-text-primary); }
            .filter-section h4 { font-size: 15px; color: var(--filter-text-primary); }
            #close-panel-btn { background: none; border: none; cursor: pointer; width: 32px; height: 32px; color: var(--filter-text-secondary); border-radius: 50%; font-size: 24px; display: flex; align-items: center; justify-content: center; }
            #close-panel-btn:hover { background-color: #e5e7eb; color: var(--filter-text-primary); }
            .input-group { display: flex; gap: 8px; }
            .input-group input { flex-grow: 1; padding: 8px 12px; border: none; border-radius: 8px; font-size: 14px; background-color: var(--filter-bg-input); box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); }
            .input-group input:focus { outline: none; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05), 0 0 0 3px rgba(59, 130, 246, 0.3); }
            .input-group button { flex-shrink: 0; width: 36px; height: 36px; color: #fff; border: none; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; }
            #add-keyword-btn { background-color: var(--filter-danger-color); }
            .keyword-list { list-style: none; padding: 0; margin: 12px 0 0 0; max-height: 200px; overflow-y: auto; }
            .keyword-list li { padding: 8px 4px 8px 12px; display: flex; justify-content: space-between; align-items: center; border-radius: 6px; }
            .keyword-list li:hover { background-color: #eef2ff; }
            .keyword-text { flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; font-size: 13px; }
            .keyword-actions { display: flex; gap: 4px; }
            .edit-keyword-btn, .remove-keyword-btn { background: none; border: none; cursor: pointer; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color: var(--filter-text-secondary); font-size: 16px; font-weight: bold; }
            .edit-keyword-btn:hover { color: #fff; background-color: var(--filter-primary-color); }
            .remove-keyword-btn { font-size: 20px; }
            .remove-keyword-btn:hover { color: #fff; background-color: var(--filter-danger-color); }
            .keyword-edit-mode { background-color: #eef2ff !important; }
            .keyword-edit-input { flex-grow: 1; padding: 6px 10px; border: 2px solid var(--filter-primary-color); border-radius: 6px; font-size: 13px; background-color: var(--filter-bg-input); }
            .keyword-edit-input:focus { outline: none; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.3); }
            .save-edit-btn, .cancel-edit-btn { background: none; border: none; cursor: pointer; border-radius: 6px; padding: 4px 8px; font-size: 12px; font-weight: 600; }
            .save-edit-btn { color: #fff; background-color: var(--filter-primary-color); }
            .save-edit-btn:hover { background-color: #2563eb; }
            .cancel-edit-btn { color: var(--filter-text-primary); background-color: #e5e7eb; }
            .cancel-edit-btn:hover { background-color: #d1d5db; }
            .button-group { display: flex; gap: 8px; margin-top: 4px; }
            .button-group button { flex: 1; padding: 8px; font-weight: 600; border: none; border-radius: 8px; cursor: pointer; transition: background-color .2s; }
            #export-btn { background-color: var(--filter-primary-color); color: #fff; }
            #import-btn { background-color: #e5e7eb; color: var(--filter-text-primary); }
            #mark-all-read-btn { background-color: var(--filter-primary-color); color: #fff; }
            #mark-all-read-btn:hover { background-color: #2563eb; }
            #clear-read-btn { background-color: #f59e0b; color: #fff; }
            #clear-read-btn:hover { background-color: #d97706; }
            .toggle-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
            .toggle-switch input { opacity: 0; width: 0; height: 0; }
            .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 22px; }
            .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: #fff; transition: .4s; border-radius: 50%; }
            input:checked + .slider { background-color: var(--filter-primary-color); }
            input:checked + .slider:before { transform: translateX(18px); }

            /* 已读帖子样式 */
            tr.default.post-read { opacity: 0.4; background-color: #f3f4f6; }
            tr.default.post-read td a { color: #9ca3af !important; text-decoration: line-through; }
            tr.default.post-read:hover { opacity: 0.6; }
        `;
        document.head.appendChild(Object.assign(document.createElement('style'), { textContent: styles }));

        const container = document.createElement('div');
        container.id = 'filter-container';
        container.innerHTML = `
            <div id="filter-toggle-view" title="打开/关闭过滤器 (左键展开, 中键开关)">${ICONS.gear}<span id="filter-count-badge"></span></div>
            <div id="filter-panel-view">
                <div class="filter-section">
                    <h3>
                        <span style="display: flex; align-items: center; gap: 10px;">过滤器<label class="toggle-switch"><input type="checkbox" id="filter-master-switch"><span class="slider"></span></label></span>
                        <button id="close-panel-btn" title="收起">&times;</button>
                    </h3>
                </div>
                <div class="filter-section">
                    <h4>已读管理</h4>
                    <div class="button-group">
                        <button id="mark-all-read-btn" type="button" title="将当前页面所有帖子标记为已读">标记已读</button>
                        <button id="clear-read-btn" type="button" title="清空所有已读记录">清空</button>
                    </div>
                </div>
                <div class="filter-section">
                    <h4>过滤关键词</h4>
                    <div class="input-group">
                        <input type="text" id="new-keyword-input" placeholder="添加要隐藏的关键词 (支持正则)..." autocomplete="off">
                        <button type="button" id="add-keyword-btn" title="添加">+</button>
                    </div>
                    <ul id="keyword-list" class="keyword-list"></ul>
                </div>
                <div class="filter-section">
                    <h4>数据备份</h4>
                    <div class="button-group">
                        <button id="import-btn" type="button">导入配置</button>
                        <button id="export-btn" type="button">导出配置</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        filterInputIds.add('new-keyword-input');

        document.getElementById('filter-toggle-view').addEventListener('mousedown', (e) => {
            if (e.button === 0) container.classList.add('expanded');
            else if (e.button === 1) {
                e.preventDefault();
                dataManager.saveFilterEnabled(!dataManager.getFilterEnabled());
                updateAllUI();
                runFullScan();
            }
        });

        document.getElementById('close-panel-btn').addEventListener('click', () => container.classList.remove('expanded'));
        document.getElementById('filter-master-switch').addEventListener('change', (e) => {
            dataManager.saveFilterEnabled(e.target.checked);
            updateAllUI();
            runFullScan();
        });

        document.getElementById('add-keyword-btn').addEventListener('click', () => {
            const input = document.getElementById('new-keyword-input');
            if (addKeyword(input.value)) {
                input.value = '';
                updateKeywordListUI();
                runFullScan();
            }
            input.focus();
        });

        document.getElementById('mark-all-read-btn').addEventListener('click', markCurrentPageAsRead);

        document.getElementById('clear-read-btn').addEventListener('click', () => {
            if (confirm('确定要清空所有已读记录吗？')) {
                dataManager.clearReadPosts();
                runFullScan();
                alert('已清空所有已读记录');
            }
        });

        document.getElementById('import-btn').addEventListener('click', importSettings);
        document.getElementById('export-btn').addEventListener('click', exportSettings);

        // 点击标题链接标记为已读
        document.addEventListener('click', (e) => {
            const link = e.target.closest('tr.default td:nth-child(2) a');
            if (link) {
                const entry = link.closest('tr.default');
                const hash = extractPostHash(entry);
                if (hash) {
                    dataManager.markAsRead(hash);
                    setTimeout(() => applyFilterToEntry(entry), 100);
                }
            }
        });
    }

    // --- UI 更新 ---
    function updateAllUI() {
        const s = dataManager.getSettings();
        document.getElementById('filter-toggle-view').classList.toggle('filter-disabled', !s.filterEnabled);
        document.getElementById('filter-master-switch').checked = s.filterEnabled;
        updateKeywordListUI();
    }

    function createKeywordListItem(keyword, onEdit, onRemove) {
        const li = document.createElement('li');
        const text = li.appendChild(document.createElement('span'));
        text.className = 'keyword-text';
        text.textContent = keyword;
        text.title = keyword;

        const actions = li.appendChild(document.createElement('div'));
        actions.className = 'keyword-actions';

        const editBtn = actions.appendChild(document.createElement('button'));
        editBtn.className = 'edit-keyword-btn';
        editBtn.title = `编辑 "${keyword}"`;
        editBtn.innerHTML = '✎';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            enterEditMode(li, keyword, onEdit);
        };

        const removeBtn = actions.appendChild(document.createElement('button'));
        removeBtn.className = 'remove-keyword-btn';
        removeBtn.title = `删除 "${keyword}"`;
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            onRemove();
        };

        return li;
    }

    function enterEditMode(li, oldKeyword, onEdit) {
        li.classList.add('keyword-edit-mode');
        li.innerHTML = '';

        const input = li.appendChild(document.createElement('input'));
        input.type = 'text';
        input.className = 'keyword-edit-input';
        input.value = oldKeyword;

        const actions = li.appendChild(document.createElement('div'));
        actions.className = 'keyword-actions';

        const saveBtn = actions.appendChild(document.createElement('button'));
        saveBtn.className = 'save-edit-btn';
        saveBtn.textContent = '保存';
        saveBtn.onclick = () => {
            const newValue = input.value.trim();
            if (newValue && newValue !== oldKeyword) {
                if (onEdit(oldKeyword, newValue)) {
                    // Success
                } else {
                    alert('关键词已存在或无效');
                    input.focus();
                }
            } else {
                exitEditMode(li, oldKeyword, onEdit);
            }
        };

        const cancelBtn = actions.appendChild(document.createElement('button'));
        cancelBtn.className = 'cancel-edit-btn';
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = () => {
            exitEditMode(li, oldKeyword, onEdit);
        };

        input.focus();
        input.select();

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                saveBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelBtn.click();
            }
        };
    }

    function exitEditMode(li, keyword, onEdit) {
        li.classList.remove('keyword-edit-mode');
        updateKeywordListUI();
    }

    function updateKeywordListUI() {
        const list = document.getElementById('keyword-list');
        list.innerHTML = '';
        const keywords = dataManager.getKeywords();
        if (!keywords.length) {
            list.innerHTML = `<li style="justify-content:center;color:var(--filter-text-secondary);pointer-events:none;background:none;">暂无过滤关键词</li>`;
            return;
        }
        keywords.forEach(k => list.appendChild(createKeywordListItem(
            k,
            (oldK, newK) => {
                if (updateKeyword(oldK, newK)) {
                    updateKeywordListUI();
                    runFullScan();
                    return true;
                }
                return false;
            },
            () => {
                removeKeyword(k);
                updateKeywordListUI();
                runFullScan();
            }
        )));
    }

    // --- 预览图与动态内容 ---
    const previewCache = new Map();

    async function loadImagesForRow(entry) {
        // 已读帖子不加载预览图
        if (entry.classList.contains('post-read')) {
            return;
        }

        const link = entry.querySelector('td:nth-child(2) a');
        const preview = entry.querySelector('.preview-thumbs');
        if (!link || !preview) return;

        preview.textContent = '加载中...';
        const imgs = await fetchPreviewImages(link.href);
        preview.innerHTML = '';

        if (!imgs.length) {
            preview.textContent = '无预览图';
            return;
        }

        imgs.forEach((src, i) => setTimeout(() => {
            if (!entry.isConnected) return;
            const img = preview.appendChild(document.createElement('img'));
            img.src = src;
            img.style.opacity = '0';
            img.style.transition = 'opacity .4s';
            img.onload = () => img.style.opacity = '1';
            img.onerror = () => img.remove();
        }, i * IMAGE_LOAD_DELAY_MS));
    }

    async function fetchPreviewImages(url) {
        if (previewCache.has(url)) return previewCache.get(url);
        try {
            const r = await fetch(url);
            const t = await r.text();
            const d = new DOMParser().parseFromString(t, 'text/html');
            const i = Array.from(d.querySelectorAll('.img-container img')).map(m => new URL(m.src, url).href);
            previewCache.set(url, i);
            return i;
        } catch (e) {
            previewCache.set(url, []);
            return [];
        }
    }

    function injectPreviewImages(entry) {
        if (!entry || entry.dataset.pi) return;

        // 已读帖子不注入预览区域
        if (entry.classList.contains('post-read')) {
            return;
        }

        entry.dataset.pi = "1";
        const link = entry.querySelector('td:nth-child(2) a');
        if (!link) return;
        link.insertAdjacentElement('afterend', Object.assign(document.createElement('div'), {
            className: 'preview-thumbs',
            textContent: '滚动加载预览'
        }));
        if (imageObserver) imageObserver.observe(entry);
    }

    function injectDynamicStyles() {
        const s = `.preview-thumbs{display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;align-items:center;min-height:20px}.preview-thumbs img{max-height:400px;max-width:400px;border-radius:4px;object-fit:cover}.container{max-width:1600px!important;width:1600px!important}table.table th:nth-child(3),td:nth-child(3){width:100px;text-align:center}`;
        let d = '';
        const h = document.querySelectorAll('table.table thead th');
        if (h.length) {
            const c = ['.hdr-category', '.hdr-size', '.hdr-date', '.hdr-ad'], i = [];
            h.forEach((t, x) => c.some(n => t.matches(n)) && i.push(x + 1));
            if (i.length) d = i.map(x => `table.table th:nth-child(${x}),td:nth-child(${x})`).join(',') + '{display:none}';
        }
        document.head.appendChild(Object.assign(document.createElement('style'), { textContent: s + d }));
    }

    function initLazyLoader() {
        imageObserver = new IntersectionObserver((entries, observer) => entries.forEach(e => {
            if (e.isIntersecting) {
                loadImagesForRow(e.target);
                observer.unobserve(e.target);
            }
        }), { rootMargin: '100px 0px' });
    }

    function observeContentChanges() {
        const t = document.querySelector('table.table tbody');
        if (!t) return;
        new MutationObserver(ms => {
            ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && n.matches('tr.default') && applyFilterToEntry(n)));
            updateFilterCount();
        }).observe(t, { childList: true });
    }

    // --- 启动 ---
    window.addEventListener('load', () => {
        initUI();
        injectDynamicStyles();
        initLazyLoader();
        runFullScan();
        updateAllUI();
        observeContentChanges();
    });
})();
