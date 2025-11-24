// ==UserScript==
// @name         Linux.do 信任等级升级进度提醒
// @namespace    http://tampermonkey.net/
// @version      3.5
// @description  实时显示 linux.do TL0→TL1→TL2 升级进度，还差什么一目了然，支持最小化
// @author       佬友们集体智慧
// @match        https://linux.do/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // 配置升级要求
    const REQUIREMENTS = {
        0: {
            topics_entered: 5,
            posts_read_count: 30,
            time_read: 600
        },
        1: {
            days_visited: 15,
            likes_given: 1,
            likes_received: 1,
            post_count: 3,
            topics_entered: 20,
            posts_read_count: 100,
            time_read: 3600
        }
    };

    const LEVEL_NAMES = {
        0: '新用户 🌱',
        1: '基本用户 ⭐',
        2: '成员 ⭐⭐',
        3: '活跃用户 ⭐⭐⭐',
        4: '领导者 🏆'
    };

    const STAT_NAMES = {
        'days_visited': '访问天数',
        'likes_given': '给出的赞',
        'likes_received': '收到的赞',
        'post_count': '帖子数量',
        'posts_read_count': '已读帖子',
        'topics_entered': '已读主题',
        'time_read': '阅读时间'
    };

    let isMinimized = localStorage.getItem('linuxdo-tl-minimized') === 'true';

    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        if (minutes >= 60) {
            return `${(minutes / 60).toFixed(1)} 小时`;
        }
        return `${minutes} 分钟`;
    }

    function calculateOverallProgress(currentTL, summary) {
        if (currentTL >= 2) return 100;

        const requirements = REQUIREMENTS[currentTL];
        let totalProgress = 0;
        let count = 0;

        for (const stat in requirements) {
            if (requirements.hasOwnProperty(stat)) {
                const reqValue = requirements[stat];
                const curValue = summary[stat] || 0;
                const percentage = Math.min((curValue / reqValue) * 100, 100);
                totalProgress += percentage;
                count++;
            }
        }

        return count > 0 ? Math.round(totalProgress / count) : 0;
    }

    function toggleMinimize() {
        isMinimized = !isMinimized;
        localStorage.setItem('linuxdo-tl-minimized', isMinimized);

        const panel = document.getElementById('linuxdo-tl-progress');
        const content = document.getElementById('linuxdo-tl-content');
        const minimizedView = document.getElementById('linuxdo-tl-minimized');

        if (!panel || !content || !minimizedView) return;

        if (isMinimized) {
            panel.style.width = '80px';
            panel.style.height = '80px';
            panel.style.padding = '0';
            panel.style.borderRadius = '50%';
            content.style.display = 'none';
            minimizedView.style.display = 'flex';
        } else {
            panel.style.width = '320px';
            panel.style.height = 'auto';
            panel.style.padding = '16px';
            panel.style.borderRadius = '12px';
            content.style.display = 'block';
            minimizedView.style.display = 'none';
        }
    }

    function createPanel(userData, summaryData) {
        const currentTL = userData.trust_level;
        const summary = summaryData.user_summary;
        const overallProgress = calculateOverallProgress(currentTL, summary);

        // 移除旧面板
        const oldPanel = document.getElementById('linuxdo-tl-progress');
        if (oldPanel) {
            oldPanel.remove();
        }

        const panel = document.createElement('div');
        panel.id = 'linuxdo-tl-progress';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: ${isMinimized ? '80px' : '320px'};
            height: ${isMinimized ? '80px' : 'auto'};
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            border: 2px solid #4ade80;
            border-radius: ${isMinimized ? '50%' : '12px'};
            padding: ${isMinimized ? '0' : '16px'};
            font-size: 13px;
            color: #e0e0e0;
            z-index: 999999;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        // 最小化视图
        const progressColor = overallProgress >= 80 ? '#4ade80' : overallProgress >= 50 ? '#fbbf24' : '#f87171';

        panel.innerHTML = `
            <div id="linuxdo-tl-minimized" style="display: ${isMinimized ? 'flex' : 'none'}; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; position: relative;">
                <div style="font-size: 20px; font-weight: bold; color: ${progressColor};">
                    ${overallProgress}%
                </div>
                <div style="font-size: 10px; color: #888; margin-top: 2px;">
                    TL${currentTL}
                </div>
            </div>
            
            <div id="linuxdo-tl-content" style="display: ${isMinimized ? 'none' : 'block'};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="font-weight:bold; color:#4ade80; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                        <span>🚀</span>
                        <span>升级进度</span>
                    </div>
                    <button id="minimize-btn" style="background: rgba(74, 222, 128, 0.2); border: 1px solid #4ade80; color: #4ade80; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px;">
                        ${isMinimized ? '展开' : '最小化'}
                    </button>
                </div>
                <div style="margin-bottom:14px; font-size: 14px; padding: 10px; background: rgba(74, 222, 128, 0.1); border-radius: 6px; border-left: 3px solid #4ade80;">
                    当前等级: <b style="color:#4ade80;">${LEVEL_NAMES[currentTL]}</b>
                    <div style="font-size: 12px; color: #aaa; margin-top: 4px;">整体进度: ${overallProgress}%</div>
                </div>
                ${currentTL < 2 ? createProgressBars(currentTL, summary) : createMaxLevelMessage()}
                <div style="font-size:10px;color:#888;margin-top:14px;text-align:right;border-top:1px solid rgba(255,255,255,0.1);padding-top:8px;">💡 数据实时更新 | 用户: ${userData.username}</div>
            </div>
        `;

        document.body.appendChild(panel);

        // 添加事件监听
        const minimizeBtn = document.getElementById('minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleMinimize();
            });
        }

        // 点击最小化视图展开
        const minimizedView = document.getElementById('linuxdo-tl-minimized');
        if (minimizedView) {
            minimizedView.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleMinimize();
            });
        }

        console.log('✅ 面板已成功添加到页面');
    }

    function createProgressBars(currentTL, summary) {
        const requirements = REQUIREMENTS[currentTL];
        let html = `<div style="background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;margin-top:10px;">`;
        html += `<div style="font-weight:bold;margin-bottom:12px;color:#4ade80;font-size:14px;">📊 升级到 TL${currentTL + 1} 进度</div>`;

        for (const stat in requirements) {
            if (requirements.hasOwnProperty(stat)) {
                const reqValue = requirements[stat];
                const curValue = summary[stat] || 0;
                const percentage = Math.min((curValue / reqValue) * 100, 100);
                const color = curValue >= reqValue ? '#4ade80' : '#f87171';

                const displayCur = stat === 'time_read' ? formatTime(curValue) : curValue;
                const displayReq = stat === 'time_read' ? formatTime(reqValue) : reqValue;

                html += `
                    <div style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
                            <span style="color:#bbb;">${STAT_NAMES[stat]}</span>
                            <span style="color:#fff;font-weight:600;">${displayCur} / ${displayReq}</span>
                        </div>
                        <div style="position: relative; height: 24px; background-color: rgba(0,0,0,0.4); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
                            <div style="height: 100%; background: linear-gradient(90deg, ${color}, ${color}cc); width: ${percentage}%;"></div>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 11px; font-weight: bold; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.9);">
                                ${Math.round(percentage)}%
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        html += '</div>';

        const allMet = Object.keys(requirements).every(stat => (summary[stat] || 0) >= requirements[stat]);
        if (allMet) {
            html += '<div style="color:#4ade80;font-weight:bold;margin-top:12px;padding:10px;background:rgba(74,222,128,0.15);border-radius:6px;text-align:center;border:1px solid #4ade80;">✅ 所有条件已满足！等待自动升级...</div>';
        }

        return html;
    }

    function createMaxLevelMessage() {
        return '<div style="color:#4ade80;font-weight:bold;margin-top:10px;padding:14px;background:rgba(74,222,128,0.15);border-radius:8px;text-align:center;font-size:15px;border:1px solid #4ade80;">🎉 恭喜！你已经是高级用户了！</div>';
    }

    async function fetchUserData(username) {
        try {
            console.log('📡 正在获取用户数据:', username);

            const [userData, summaryData] = await Promise.all([
                fetch(`https://linux.do/u/${username}.json`).then(res => res.json()),
                fetch(`https://linux.do/u/${username}/summary.json`).then(res => res.json())
            ]);

            console.log('✅ 用户数据获取成功');

            if (userData && summaryData) {
                createPanel(userData.user, summaryData);
            }
        } catch (error) {
            console.error('❌ 获取用户数据失败:', error);
        }
    }

    function getCurrentUsername() {
        // 方法1: 从 Discourse 全局对象获取
        if (window.Discourse && window.Discourse.User && window.Discourse.User.current()) {
            const username = window.Discourse.User.current().username;
            console.log('✅ 从 Discourse 对象获取到用户名:', username);
            return username;
        }

        // 方法2: 从当前用户菜单获取
        const currentUserBtn = document.querySelector('#current-user button');
        if (currentUserBtn) {
            const href = currentUserBtn.getAttribute('href');
            if (href) {
                const username = href.replace('/u/', '');
                console.log('✅ 从用户按钮获取到用户名:', username);
                return username;
            }
        }

        // 方法3: 从预加载数据获取
        const preloadedScript = document.querySelector('script[data-preloaded]');
        if (preloadedScript) {
            try {
                const jsonData = JSON.parse(preloadedScript.innerHTML);
                const userDataKey = Object.keys(jsonData).find(key => key.startsWith('currentUser'));
                if (userDataKey) {
                    const userData = JSON.parse(jsonData[userDataKey]);
                    const username = userData.user.username;
                    console.log('✅ 从预加载数据获取到用户名:', username);
                    return username;
                }
            } catch (e) {
                console.log('⚠️ 解析预加载数据失败');
            }
        }

        return null;
    }

    function init() {
        console.log('🚀 Linux.do 升级进度脚本启动...');

        const checkDiscourse = setInterval(() => {
            const username = getCurrentUsername();

            if (username) {
                console.log('✅ 找到用户，开始加载数据');
                clearInterval(checkDiscourse);
                fetchUserData(username);
            }
        }, 500);

        setTimeout(() => {
            clearInterval(checkDiscourse);
        }, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }

    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(init, 1500);
        }
    }).observe(document.body, { childList: true, subtree: true });

})();