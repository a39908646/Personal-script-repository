// ==UserScript==
// @name         草榴详情页显示优化
// @namespace    http://tampermonkey.net/
// @version      7.4.0-ui-tweaks
// @description  详情页UI优化（白色背景、移除边框、调整图片大小），修正图片重排问题，并自动转换所有下载链接为磁力链接。
// @match        https://*.t66y.com/htm_data/*
// @match        https://t66y.com/htm_data/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log('[ISOLATED-OPTIMIZER] Script started. Running in isolated mode.');

    // ★ 使用被验证成功的“强力轮询”机制
    let attempts = 0;
    const maxAttempts = 20; // 持续10秒

    const intervalId = setInterval(() => {
        const contentContainer = document.querySelector('.tpc_content');
        if (!contentContainer) {
            if (attempts < maxAttempts) {
                 attempts++;
                 return;
            }
        }

        attempts++;
        console.log(`[ISOLATED-OPTIMIZER] Attempt #${attempts}.`);

        // 一旦找到内容容器，就执行优化并停止轮询
        if (contentContainer) {
            console.log(`[ISOLATED-OPTIMIZER] Content container found! Applying optimizations...`);
            clearInterval(intervalId); // 立即停止轮询

            try {
                // ==========================================================
                // ★ 注入样式（已根据您的要求更新）
                // ==========================================================
                const styleId = 'detail-page-optimizer-style-isolated';
                if (!document.getElementById(styleId)) {
                    const style = document.createElement('style');
                    style.id = styleId;
                    style.innerHTML = `
                        /* 1. 去掉body屎黄色的背景色 */
                        body {
                            background-color: #fff !important;
                        }
                        /* 2. 去掉.t元素的边框 */
                        .t {
                            border: none !important;
                        }

                        #header, #main {max-width: 1500px !important;}
                        tr.tr1 > th:first-child { display: none !important; }
                        .image-gallery-container {
                            display: flex; flex-wrap: wrap; gap: 10px; justify-content: center;
                            margin-top: 20px; padding-top: 20px;
                        }
                        .image-gallery-container img {
                            /* 3. 把图片的最大宽度设置为700px */
                            max-width: 700px;
                            max-height: 800px;
                            width: auto;
                            height: auto;
                            border-radius: 6px;
                            object-fit: contain;
                            cursor: pointer !important;
                        }
                        .tpc_content a[href^="magnet:"], .tpc_content a[href*="rmdown"] {
                            display: block; background-color: #27ae60; color: white !important;
                            text-align: center; padding: 12px; border-radius: 8px; margin: 15px 0;
                            font-size: 16px; font-weight: bold; text-decoration: none;
                            transition: background-color 0.2s; word-wrap: break-word;
                        }
                        .tpc_content a[href^="magnet:"]:hover, .tpc_content a[href*="rmdown"]:hover { background-color: #2ecc71; }
                    `;
                    document.head.appendChild(style);
                }

                // 链接转换逻辑
                const downloadLinks = document.querySelectorAll('a#rmlink, .tpc_content a[href*="rmdown"]');
                if (downloadLinks.length > 0) {
                    console.log(`[ISOLATED-OPTIMIZER] Found ${downloadLinks.length} potential download links. Converting...`);
                    const reg = /http.*hash=\w{3}/gm;
                    downloadLinks.forEach(link => {
                        if (link && link.href && link.href.includes('hash=')) {
                            link.href = link.href.replace(reg, "magnet:?xt=urn:btih:");
                        }
                    });
                     console.log('[ISOLATED-OPTIMIZER] All applicable links converted to magnet links.');
                }

                // 图片重排逻辑
                const images = document.querySelectorAll('.tpc_content img[ess-data]');
                if (images.length === 0) {
                    console.log('[ISOLATED-OPTIMIZER] No images found, skipping gallery creation.');
                    return;
                }
                if (document.querySelector('.image-gallery-container')) return;

                const galleryContainer = document.createElement('div');
                galleryContainer.className = 'image-gallery-container';
                images[0].parentNode.insertBefore(galleryContainer, images[0]);

                let currentNode = galleryContainer.nextSibling;
                while (currentNode) {
                    const nextNode = currentNode.nextSibling;
                    if (currentNode.nodeName === 'IMG' || currentNode.nodeName === 'BR') {
                        galleryContainer.appendChild(currentNode);
                    }
                    currentNode = nextNode;
                }
                console.log('[ISOLATED-OPTIMIZER] Image gallery layout fix applied successfully.');

            } catch (error) {
                console.error('[ISOLATED-OPTIMIZER] An error occurred during optimization:', error);
            }

        } else if (attempts >= maxAttempts) {
            console.error('[ISOLATED-OPTIMIZER] Max attempts reached, no content container found. Stopping.');
            clearInterval(intervalId); // 超时停止
        }
    }, 500);

})();