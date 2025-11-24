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
            if (videoId && !isVideoRead(videoId)) {
                readPosts[videoId] = now;
                applyReadStyle(elem, videoId);
                count++;
            }
        });

        if (count > 0) {
            saveReadPosts(readPosts);
            showToast(`已标记 ${count} 个视频为已阅`, 'success');
        } else {
            showToast('没有找到未读视频', 'info');
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
            videoElement.style.display = "";
            return;
        }

        // 使用精确的标题选择器
        const titleElement = videoElement.querySelector('span.video-title');
        if (!titleElement) return;

        const titleText = titleElement.textContent || "";

        try {
            videoElement.style.display = excludeKeywords.some(kw => kw && new RegExp(kw, 'i').test(titleText)) ? "none" : "";
        } catch (e) {
            console.error("无效的正则表达式:", e.message);
            videoElement.style.display = "";
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

        /* 面板容器 - 现代毛玻璃风格 */
        .filter-panel { 
            position: fixed; 
            top: 100px; 
            right: 30px; 
            background: rgba(255, 255, 255, 0.95); 
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: #333; 
            padding: 16px; 
            border-radius: 16px; 
            box-shadow: 0 10px 40px rgba(0,0,0,0.15); 
            font-size: 14px; 
            z-index: 9999; 
            width: 280px; 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            display: flex; 
            flex-direction: column; 
            gap: 12px; 
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 1;
            transform: translateY(0);
        }

        /* 标题栏 */
        .filter-panel header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
            padding-bottom: 12px;
        }
        .filter-panel h3 { 
            margin: 0; 
            font-size: 16px; 
            font-weight: 700; 
            color: #1a1a1a; 
            display: flex; 
            align-items: center;
            gap: 8px;
        }
        .filter-panel h3::before {
            content: "🛡️";
            font-size: 18px;
        }

        /* 分区标题 */
        .filter-panel h4 { 
            margin: 0 0 8px 0; 
            font-size: 12px; 
            font-weight: 600; 
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #888; 
        }

        /* 控制区布局 */
        .panel-controls { 
            display: flex; 
            align-items: center; 
            gap: 12px; 
        }

        /* 最小化按钮 */
        .minimize-btn { 
            background: transparent; 
            border: none; 
            width: 24px; 
            height: 24px; 
            border-radius: 50%; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            cursor: pointer; 
            color: #999; 
            transition: all 0.2s; 
        }
        .minimize-btn:hover { 
            background: rgba(0,0,0,0.05); 
            color: #333; 
        }

        /* 展开按钮 - 悬浮球风格 */
        .expand-btn { 
            position: fixed; 
            top: 100px; 
            right: 30px; 
            background: white; 
            color: #333; 
            border-radius: 50%; 
            width: 48px; 
            height: 48px; 
            display: none; 
            align-items: center; 
            justify-content: center; 
            cursor: pointer; 
            z-index: 10000; 
            font-size: 20px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); 
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            border: none;
        }
        .expand-btn:hover { 
            transform: scale(1.1) rotate(90deg); 
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        }
        .expand-btn.show { display: flex; }

        /* 开关控件 */
        .switch { 
            position: relative; 
            display: inline-block; 
            width: 40px; 
            height: 22px; 
        }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { 
            position: absolute; 
            cursor: pointer; 
            top: 0; 
            left: 0; 
            right: 0; 
            bottom: 0; 
            background-color: #e0e0e0; 
            transition: .3s; 
            border-radius: 22px; 
        }
        .slider:before { 
            position: absolute; 
            content: ""; 
            height: 18px; 
            width: 18px; 
            left: 2px; 
            bottom: 2px; 
            background-color: white; 
            transition: .3s cubic-bezier(0.4, 0.0, 0.2, 1); 
            border-radius: 50%; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        input:checked + .slider { background-color: #4CAF50; }
        input:checked + .slider:before { transform: translateX(18px); }

        /* 统计卡片 */
        .read-stats {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 10px;
            margin-bottom: 12px;
        }
        .stat-label { color: #666; font-weight: 500; }
        .stat-value { 
            font-size: 16px; 
            font-weight: 700; 
            color: #2196F3; 
            font-family: "SF Mono", "Roboto Mono", monospace;
        }

        /* 按钮组 */
        .batch-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            width: 100%;
        }
        .batch-btn {
            padding: 10px;
            border: none;
            border-radius: 8px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .batch-btn-primary {
            background: linear-gradient(135deg, #3498db, #2980b9);
            color: white;
            box-shadow: 0 4px 10px rgba(52, 152, 219, 0.3);
        }
        .batch-btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 15px rgba(52, 152, 219, 0.4);
        }
        .batch-btn-danger {
            background: linear-gradient(135deg, #ff6b6b, #ee5253);
            color: white;
            box-shadow: 0 4px 10px rgba(238, 82, 83, 0.3);
        }
        .batch-btn-danger:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 15px rgba(238, 82, 83, 0.4);
        }
        .batch-btn:active { transform: translateY(0); }

        /* 关键词列表 */
        .kw-list { 
            display: flex; 
            flex-wrap: wrap;
            gap: 6px; 
            margin: 8px 0; 
            max-height: 120px; 
            overflow-y: auto; 
            padding: 2px;
        }
        .kw { 
            display: inline-flex; 
            align-items: center; 
            background: #fff; 
            border-radius: 20px; 
            padding: 4px 10px; 
            font-size: 12px; 
            color: #555;
            transition: all 0.2s;
            box-shadow: 0 2px 5px rgba(0,0,0,0.03);
        }
        .kw:hover { 
            background: #f0f7ff; 
            color: #0056b3;
        }
        .kw button { 
            background: none; 
            border: none; 
            font-size: 14px; 
            color: #ccc; 
            cursor: pointer; 
            margin-left: 6px; 
            padding: 0;
            line-height: 1;
            display: flex;
        }
        .kw button:hover { color: #ff4757; }

        /* 输入框区域 */
        .input-wrapper { 
            display: flex; 
            gap: 8px; 
            margin-top: 8px; 
            background: #fff;
            padding: 4px;
            border-radius: 8px;
            border: none !important;
            box-shadow: none !important;
        }
        .filter-panel input[type="text"] { 
            flex: 1; 
            border: none !important; 
            padding: 8px; 
            font-size: 13px; 
            outline: none !important;
            background: transparent !important;
            box-shadow: none !important;
        }
        .filter-panel .add-kw-btn { 
            padding: 6px 16px; 
            border: none; 
            background: #2f3542; 
            color: white; 
            border-radius: 6px; 
            cursor: pointer; 
            font-size: 12px; 
            font-weight: 600;
            transition: all 0.2s; 
        }
        .filter-panel .add-kw-btn:hover { 
            background: #57606f; 
        }

        /* Toast 提示样式 */
        .toast {
            position: fixed;
            bottom: 40px;
            right: 40px;
            padding: 14px 24px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 600;
            color: white;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
            z-index: 10001;
            opacity: 0;
            transform: translateY(30px) scale(0.9);
            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            pointer-events: none;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .toast.show {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        .toast-success { background: linear-gradient(135deg, #00b09b, #96c93d); }
        .toast-error { background: linear-gradient(135deg, #ff5f6d, #ffc371); }
        .toast-info { background: linear-gradient(135deg, #2193b0, #6dd5ed); }
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
