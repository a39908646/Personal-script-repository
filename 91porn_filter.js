// ==UserScript==
// @name         91porn 批量标记已读、过滤优化
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  批量标记已读 | 已读条目置灰 | 数据持久化存储 | 自动清理3个月过期数据 | 关键词过滤
// @match        https://91porn.com/v.php*
// @match        https://*.91porn.com/v.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

; (() => {
    'use strict';

    // ================================================================= //
    //                       ★ 核心配置参数 ★
    // ================================================================= //

    const READ_EXPIRE_DAYS = 90;         // 已阅记录过期天数（3个月）

    // ================================================================= //
    //                       ★ 存储配置 ★
    // ================================================================= //

    const EXCLUDE_KEY = "91porn_excludeKeywords";
    const PANEL_STATE_KEY = "91porn_filterPanelMinimized";
    const FILTER_ENABLED_KEY = "91porn_filterEnabled";
    const READ_POSTS_KEY = "91porn_readPosts";

    // --- 存取函数 ---
    const getExcludeKeywords = () => GM_getValue(EXCLUDE_KEY, []);
    const setExcludeKeywords = (list) => GM_setValue(EXCLUDE_KEY, list);
    const getPanelState = () => GM_getValue(PANEL_STATE_KEY, "max");
    const setPanelState = (state) => GM_setValue(PANEL_STATE_KEY, state);
    const getFilterEnabled = () => GM_getValue(FILTER_ENABLED_KEY, true);
    const setFilterEnabled = (isEnabled) => GM_setValue(FILTER_ENABLED_KEY, isEnabled);

    // 已阅记录存储结构: { videoId: timestamp }
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
     * 从视频元素提取视频ID
     * @param {HTMLElement} videoElement - 视频条目元素
     * @returns {string|null} 视频ID (viewkey)
     */
    function getVideoId(videoElement) {
        if (!videoElement) return null;

        // 优先从data属性获取（如果已经设置）
        if (videoElement.dataset && videoElement.dataset.viewkey) {
            return videoElement.dataset.viewkey;
        }

        // 从链接的viewkey参数提取
        const link = videoElement.querySelector('a[href*="view_video.php"]');
        if (link) {
            const match = link.href.match(/viewkey=([^&]+)/);
            if (match) {
                const viewkey = match[1];
                // 缓存到data属性
                videoElement.dataset.viewkey = viewkey;
                return viewkey;
            }
        }

        return null;
    }

    /**
     * 标记视频为已阅
     * @param {string} videoId - 视频ID
     */
    function markVideoAsRead(videoId) {
        if (!videoId) return;
        readPosts[videoId] = Date.now();
        saveReadPosts(readPosts);
    }

    /**
     * 检查视频是否已阅
     * @param {string} videoId - 视频ID
     * @returns {boolean}
     */
    function isVideoRead(videoId) {
        return videoId && videoId in readPosts;
    }

    /**
     * 清理过期的已阅记录
     * @returns {number} 清理的记录数
     */
    function cleanExpiredReadPosts() {
        const now = Date.now();
        const expireTime = READ_EXPIRE_DAYS * 24 * 60 * 60 * 1000; // 转换为毫秒
        let cleanedCount = 0;

        Object.keys(readPosts).forEach(videoId => {
            const timestamp = readPosts[videoId];
            // 如果记录超过过期时间，或者时间戳无效
            if (!timestamp || (now - timestamp) > expireTime) {
                delete readPosts[videoId];
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
     * 应用已阅样式到视频条目
     * @param {HTMLElement} videoElement - 视频条目元素
     * @param {string} videoId - 视频ID
     */
    function applyReadStyle(videoElement, videoId) {
        if (!isVideoRead(videoId)) return;

        // 直接隐藏已读视频
        videoElement.style.display = 'none';
        videoElement.classList.add('video-read');
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
     * 批量标记当前页所有视频为已阅
     */
    function markAllVideosAsRead() {
        let count = 0;
        const now = Date.now();

        // 使用精确的选择器
        const videoElements = document.querySelectorAll('div.well.well-sm.videos-text-align');

        videoElements.forEach(elem => {
            // 跳过已被过滤隐藏的视频
            if (elem.style.display === 'none') {
                return;
            }

            const videoId = getVideoId(elem);
            if (videoId) {
                // 如果未读，则标记为已读并计数
                if (!isVideoRead(videoId)) {
                    readPosts[videoId] = now;
                    count++;
                }
                // 无论是否刚标记，都应用已阅样式（隐藏）
                // 这确保了页面上如果有重复的视频（相同ID），都会被隐藏
                applyReadStyle(elem, videoId);
            }
        });

        if (count > 0) {
            saveReadPosts(readPosts);
            showToast(`已标记 ${count} 个视频为已阅`, 'success');
        } else {
            // 如果没有新标记的，但可能隐藏了重复的，提示一下
            showToast('所有视频已标记为已阅', 'info');
        }
    }

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

        // 处理所有视频条目
        processAllVideos();

        // 监听DOM变化（用于动态加载的内容）
        observePageForNewVideos();

        buildPanel();
    }

    /**
     * 处理所有视频条目
     */
    function processAllVideos() {
        // 使用精确的选择器：div.well.well-sm.videos-text-align
        const videoElements = document.querySelectorAll('div.well.well-sm.videos-text-align');

        videoElements.forEach(processVideoElement);
    }

    /**
     * 集中处理单个视频条目的函数
     */
    function processVideoElement(videoElement) {
        // 应用过滤
        applyFilterToElement(videoElement);

        if (videoElement.style.display === 'none') {
            return;
        }

        // 获取视频ID并应用已阅样式
        const videoId = getVideoId(videoElement);

        // 应用已阅样式
        if (videoId) {
            applyReadStyle(videoElement, videoId);

            // 添加点击事件监听，标记为已阅
            const link = videoElement.querySelector('a[href*="view_video.php"]');
            if (link && !link.dataset.readListenerAdded) {
                link.addEventListener('click', () => {
                    markVideoAsRead(videoId);
                    applyReadStyle(videoElement, videoId);
                });
                link.dataset.readListenerAdded = 'true';
            }
        }
    }

    // ================================================================= //
    //                       ★ 过滤功能 ★
    // ================================================================= //

    function applyFilterToElement(videoElement) {
        if (!isFilterEnabled) {
            // 只有当没有被标记为已读时，才恢复显示
            // 注意：已读视频有 .video-read 类和 !important 样式，所以这里设置空字符串不会导致已读视频显示
            if (!videoElement.classList.contains('video-read')) {
                videoElement.style.display = "";
            }
            return;
        }

        // 获取整个条目的文本内容进行过滤
        // 这样可以过滤作者、时长、添加时间等所有信息
        const fullText = (videoElement.textContent || "").trim();

        if (!fullText) return;

        try {
            const shouldHide = excludeKeywords.some(kw => kw && new RegExp(kw, 'i').test(fullText));
            if (shouldHide) {
                videoElement.style.display = "none";
            } else {
                // 只有非已读视频才恢复显示
                if (!videoElement.classList.contains('video-read')) {
                    videoElement.style.display = "";
                }
            }
        } catch (e) {
            console.error("无效的正则表达式:", e.message);
        }
    }

    function applyFilterToAll() {
        const videoElements = document.querySelectorAll('div.well.well-sm.videos-text-align');
        videoElements.forEach(elem => {
            applyFilterToElement(elem);
        });
    }

    /**
     * 监听页面DOM变化
     */
    function observePageForNewVideos() {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        // 检查是否是视频元素
                        if (node.matches('div.well.well-sm.videos-text-align')) {
                            processVideoElement(node);
                        }
                        // 检查子元素
                        const videoElems = node.querySelectorAll('div.well.well-sm.videos-text-align');
                        videoElems.forEach(processVideoElement);
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ================================================================= //
    //                       ★ 控制面板 ★
    // ================================================================= //

    function buildPanel() {
        const panel = document.createElement("div");
        panel.className = "filter-panel";
        panel.innerHTML = `
        <header>
            <h3>
                <span>91porn 优化设置</span>
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
                    <span class="stat-label">已阅视频:</span>
                    <span class="stat-value" id="read-count">0</span>
                </div>
                <div class="batch-buttons">
                    <button id="mark-all-btn" class="batch-btn batch-btn-primary" title="标记本页所有视频为已阅">全部标记</button>
                    <button id="clear-read-btn" class="batch-btn batch-btn-danger" title="清除全部历史已阅记录">清空全部</button>
                </div>
            </div>
        </section>
        <section id="exclude-section">
            <h4 class="exclude">过滤关键词</h4>
            <div class="input-wrapper">
                <input type="text" id="exclude-kw-input" placeholder="输入正则表达式..."/>
                <button data-type="exclude" class="add-kw-btn">添加</button>
            </div>
            <div id="exclude-kw-list" class="kw-list"></div>
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
        markAllBtn.addEventListener("click", markAllVideosAsRead);
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
                row.className = "kw-row";
                row.innerHTML = `<span class="kw-text" title="${kw}">${kw}</span><button class="kw-delete" data-idx="${i}">✖</button>`;
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

    // ================================================================= //
    //                       ★ 样式注入 ★
    // ================================================================= //

    function injectStyles() {
        const listStyle = document.createElement("style");
        listStyle.innerHTML = `
        /* 已阅视频样式 - 直接隐藏 */
        .video-read {
            display: none !important;
        }

        /* 面板容器 - 卡片式设计 */
        .filter-panel { 
            position: fixed; 
            top: 100px; 
            right: 20px; 
            background: #ffffff; 
            border: 1px solid #e0e0e0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
            color: #333; 
            padding: 16px; 
            border-radius: 8px; 
            font-size: 13px; 
            z-index: 9999; 
            width: 300px; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            display: flex; 
            flex-direction: column; 
            gap: 12px; 
            transition: opacity 0.2s;
        }

        /* 标题栏 */
        .filter-panel header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .filter-panel h3 { 
            margin: 0; 
            font-size: 15px; 
            font-weight: 700; 
            color: #2c3e50;
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
        }
        .panel-controls {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        /* 最小化按钮 */
        .minimize-btn { 
            background: none; 
            border: none; 
            color: #999; 
            font-size: 18px; 
            cursor: pointer; 
            padding: 0 4px;
            line-height: 1;
            transition: color 0.2s;
        }
        .minimize-btn:hover { color: #333; }

        /* 展开按钮 */
        .expand-btn {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 40px;
            height: 40px;
            background: #fff;
            border: 1px solid #e0e0e0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-radius: 50%;
            cursor: pointer;
            z-index: 9999;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            transition: all 0.2s;
        }
        .expand-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .expand-btn.show { display: flex; }

        /* 开关控件 */
        .switch { 
            position: relative; 
            display: inline-block; 
            width: 36px; 
            height: 20px; 
        }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { 
            position: absolute; 
            cursor: pointer; 
            top: 0; left: 0; right: 0; bottom: 0; 
            background-color: #ccc; 
            transition: .3s; 
            border-radius: 20px; 
        }
        .slider:before { 
            position: absolute; 
            content: ""; 
            height: 16px; 
            width: 16px; 
            left: 2px; 
            bottom: 2px; 
            background-color: white; 
            transition: .3s; 
            border-radius: 50%; 
        }
        input:checked + .slider { background-color: #2196F3; }
        input:checked + .slider:before { transform: translateX(16px); }

        /* 统计区域 */
        .read-mark-controls {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .read-stats {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: #f8f9fa;
            border-radius: 6px;
        }
        .stat-label { color: #666; font-weight: 500; }
        .stat-value { 
            font-size: 15px; 
            font-weight: 700; 
            color: #2196F3; 
            font-family: monospace;
        }

        /* 按钮组 */
        .batch-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .batch-btn {
            padding: 8px 12px;
            border: 1px solid transparent;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
            text-align: center;
        }
        .batch-btn-primary {
            background-color: #2196F3;
            color: white;
            border-color: #1e88e5;
        }
        .batch-btn-primary:hover {
            background-color: #1976D2;
        }
        .batch-btn-danger {
            background-color: #fff;
            color: #dc3545;
            border-color: #dc3545;
        }
        .batch-btn-danger:hover {
            background-color: #dc3545;
            color: white;
        }

        /* 过滤区域 */
        #exclude-section {
            padding-top: 8px;
            margin-top: 4px;
        }
        .filter-panel h4 { 
            margin: 0 0 10px 0; 
            font-size: 15px; 
            font-weight: 600; 
            color: #000000; 
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* 关键词列表 */
        .kw-list { 
            display: flex; 
            flex-direction: column;
            gap: 6px; 
            margin-top: 4px; 
            max-height: 150px; 
            overflow-y: auto;
            padding-right: 4px;
        }
        .kw-row { 
            display: flex; 
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            font-size: 12px; 
            color: #495057;
            transition: background 0.2s;
        }
        .kw-row:hover { 
            background: #e9ecef; 
            border-radius: 4px;
        }
        .kw-text {
            flex: 1;
            word-break: break-all;
            line-height: 1.4;
            padding-right: 8px;
            text-align: left;
        }
        .kw-delete { 
            background: none; 
            border: none; 
            font-size: 16px; 
            color: #adb5bd; 
            cursor: pointer; 
            padding: 0;
            line-height: 1;
            display: flex;
            flex-shrink: 0;
            width: 20px;
            height: 20px;
            align-items: center;
            justify-content: center;
        }
        .kw-delete:hover { 
            color: #dc3545; 
            transform: scale(1.2);
        }

        /* 输入框区域 */
        .input-wrapper { 
            display: flex; 
            gap: 6px; 
        }
        .filter-panel input[type="text"] { 
            flex: 1; 
            border: none !important;
            border-radius: 4px;
            padding: 6px 10px; 
            font-size: 13px; 
            outline: none !important;
            background: #eee;
            color: #495057;
            box-shadow: none !important;
        }
        .filter-panel .add-kw-btn { 
            padding: 6px 12px; 
            border: 1px solid #ced4da; 
            background: #f8f9fa; 
            color: #495057; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 13px; 
            font-weight: 500;
            transition: all 0.2s; 
        }
        .filter-panel .add-kw-btn:hover { 
            background: #e2e6ea; 
            border-color: #adb5bd;
        }

        /* Toast 提示样式 */
        .toast {
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 10px 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border-radius: 4px;
            font-size: 14px;
            z-index: 10000;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .toast-success { border-left: 4px solid #2ecc71; }
        .toast-info { border-left: 4px solid #3498db; }
        .toast-error { border-left: 4px solid #e74c3c; }
        `;
        document.head.appendChild(listStyle);
    }

    // ================================================================= //
    //                         ★ 主逻辑判断 ★
    // ================================================================= //

    // 等待页面加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initListPage);
    } else {
        initListPage();
    }

})();
