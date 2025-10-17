// ==UserScript==
// @name 草榴社区显示优化 (过滤+预览+细滚动条)
// @namespace http://tampermonkey.net/
// @version 4.9.1
// @description 关键词过滤(正向+反向/大小写不敏感) + 极简面板 + 无限滚动 + Tampermonkey存储
// @match https://*.t66y.com/*
// @match https://t66y.com/*
// @grant GM_getValue
// @grant GM_setValue
// ==/UserScript==

;(() => {
const EXCLUDE_KEY = "excludeKeywords"
const INCLUDE_KEY = "includeKeywords"
const PANEL_STATE_KEY = "filterPanelMinimized"
const FILTER_ENABLED_KEY = "filterEnabled"

//-------------------------------
// 存取函数 (封装)
//-------------------------------
const getExcludeKeywords = () => GM_getValue(EXCLUDE_KEY, [])
const setExcludeKeywords = (list) => GM_setValue(EXCLUDE_KEY, list)

const getIncludeKeywords = () => GM_getValue(INCLUDE_KEY, [])
const setIncludeKeywords = (list) => GM_setValue(INCLUDE_KEY, list)

const getPanelState = () => GM_getValue(PANEL_STATE_KEY, "max")
const setPanelState = (state) => GM_setValue(PANEL_STATE_KEY, state)

const getFilterEnabled = () => GM_getValue(FILTER_ENABLED_KEY, true)
const setFilterEnabled = (isEnabled) => GM_setValue(FILTER_ENABLED_KEY, isEnabled)

let excludeKeywords = getExcludeKeywords()
let includeKeywords = getIncludeKeywords()
let isFilterEnabled = getFilterEnabled()

//-------------------------------
// 样式
//-------------------------------
const style = document.createElement("style")
style.innerHTML = `
#header, #main { max-width: 1600px !important; }
.preview-wrapper { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.preview-wrapper img { height: auto; max-height: 200px; cursor: pointer; border-radius: 4px; transition: opacity 0.2s; }
.preview-wrapper img:hover { opacity: 0.85; }
.filter-panel { position: fixed; top: 80px; right: 20px; background: #fafafa; color: #333; padding: 10px 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); font-size: 13px; z-index: 9999; width: 180px; font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 5px; }
.filter-panel h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #222; display: flex; justify-content: space-between; align-items: center; }
.filter-panel h4 { margin: 8px 0 4px 0; font-size: 12px; font-weight: 600; color: #555; border-bottom: 1px solid #eee; padding-bottom: 4px; }
.filter-panel h4.include { color: #27ae60; }
.filter-panel h4.exclude { color: #c0392b; }
.panel-controls { display: flex; align-items: center; gap: 8px; }
.input-wrapper { display: flex; gap: 6px; margin-top: 6px; }
.filter-panel input[type="text"] { flex: 1; width: auto; margin-top: 0; padding: 5px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px; box-sizing: border-box; background: #fff; min-width: 40px; }
.filter-panel .add-kw-btn { padding: 5px 12px; border: 1px solid #ddd; background: #f0f0f0; color: #333; border-radius: 6px; cursor: pointer; font-size: 12px; transition: background 0.2s; flex-shrink: 0; }
.filter-panel .add-kw-btn:hover { background: #e0e0e0; }
.kw-list { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; max-height: 150px; overflow-y: auto; padding-right: 2px; scrollbar-width: thin; scrollbar-color: transparent transparent; }
.kw-list::-webkit-scrollbar { width: 4px; }
.kw-list::-webkit-scrollbar-track { background: transparent; }
.kw-list::-webkit-scrollbar-thumb { background-color: transparent; border-radius: 2px; }
.kw-list:hover::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.35); }
.kw { display: flex; justify-content: space-between; align-items: center; background: #fdfdfd; border-radius: 6px; padding: 4px 8px; font-size: 12px; user-select: none; transition: background 0.2s; }
.kw:hover { background: #f0f0f0; }
.kw button { background: none; border: none; font-size: 13px; color: #aaa; cursor: pointer; margin-left: 8px; }
.kw button:hover { color: #e74c3c; }
.minimize-btn { background:none; border:none; font-size: 16px; font-weight: bold; cursor:pointer; color:#999; padding: 0 4px; line-height: 1; }
.minimize-btn:hover { color:#555; }
.expand-btn { position: fixed; top: 80px; right: 20px; background: #fafafa; color: #333; border-radius: 50%; width: 28px; height: 28px; display: none; align-items: center; justify-content: center; cursor: pointer; z-index: 10000; font-size: 15px; box-shadow: 0 2px 6px rgba(0,0,0,0.25); border: none; }
.expand-btn.show { display:flex; }
.switch { position: relative; display: inline-block; width: 34px; height: 20px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px; }
.slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
input:checked + .slider { background-color: #4CAF50; }
input:checked + .slider:before { transform: translateX(14px); }
`
document.head.appendChild(style)

//-------------------------------
// 帖子行处理函数
//-------------------------------
function cleanupNonDataRows() {
    let attempts = 0;
    const maxAttempts = 50; // 5秒超时
    const interval = setInterval(() => {
        const firstTbody = document.querySelector("#ajaxtable > tbody:first-of-type");
        if (firstTbody) {
            const rowsToHide = firstTbody.querySelectorAll(":scope > tr");
            rowsToHide.forEach(row => { row.style.display = 'none'; });
            clearInterval(interval);
        } else {
            attempts++;
            if (attempts > maxAttempts) { clearInterval(interval); }
        }
    }, 100);
}

function cleanRow(tr) {
  Array.from(tr.children).forEach((td, i) => {
    if (i !== 1) {
      td.style.display = 'none';
    }
  })
}

// --- 修改：过滤逻辑变为大小写不敏感 ---
function applyFilterToRow(tr) {
  if (!isFilterEnabled) {
    tr.style.display = ""
    return
  }
  const titleDom = tr.querySelector("td.tal h3 a")
  if (!titleDom) return
  const titleText = titleDom.textContent || ""
  const lowerTitleText = titleText.toLowerCase(); // 转换标题为小写

  if (includeKeywords.length > 0) {
    const isIncluded = includeKeywords.some(kw => kw && lowerTitleText.includes(kw.toLowerCase()))
    if (isIncluded) {
      tr.style.display = ""
      return
    }
  }
  const isExcluded = excludeKeywords.some(kw => kw && lowerTitleText.includes(kw.toLowerCase()))
  tr.style.display = isExcluded ? "none" : ""
}

function applyPreviewToRow(tr) {
  const item = tr.querySelector("td.tal"); if (!item) return;
  const aDom = item.querySelector("h3 > a"); if (!aDom) return;
  const pageUrl = aDom.href; if (!pageUrl) return;
  if (item.querySelector(".preview-wrapper")) return;
  fetch(pageUrl).then(res => res.text()).then(txt => {
    const dom = document.createElement("div"); dom.innerHTML = txt;
    const imgs = dom.querySelectorAll("img[ess-data]"); if (!imgs.length) return;
    let html = "";
    imgs.forEach(img => { const src = img.getAttribute("ess-data"); html += `<a href="${pageUrl}" target="_blank"><img src="${src}"></a>`; });
    const wrap = document.createElement("div"); wrap.className = "preview-wrapper"; wrap.innerHTML = html;
    const h3 = item.querySelector("h3"); if (h3) h3.insertAdjacentElement("afterend", wrap);
  });
}

//-------------------------------
// 初始化与监听
//-------------------------------
cleanupNonDataRows();

const mainContentRows = document.querySelectorAll("#tbody > tr")
mainContentRows.forEach(tr => {
    cleanRow(tr);
    applyFilterToRow(tr);
    applyPreviewToRow(tr);
});

function observeTable() {
  const mainTbody = document.querySelector("#tbody")
  if (!mainTbody) return
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.matches("tr")) {
            cleanRow(node);
            applyFilterToRow(node);
            applyPreviewToRow(node);
        }
      })
    }
  })
  observer.observe(mainTbody, { childList: true })
}
observeTable()

function applyFilterToAll() {
  document.querySelectorAll("#tbody > tr").forEach(applyFilterToRow)
}

//-------------------------------
// 面板
//-------------------------------
function buildPanel() {
  const panel = document.createElement("div")
  panel.className = "filter-panel"
  panel.innerHTML = `
    <header>
      <h3>
        <span>显示优化设置</span>
        <div class="panel-controls">
          <label class="switch">
            <input type="checkbox" id="filter-toggle">
            <span class="slider"></span>
          </label>
          <button class="minimize-btn" title="最小化">－</button>
        </div>
      </h3>
    </header>
    <section id="include-section">
      <h4 class="include">保留关键词 (优先)</h4>
      <div id="include-kw-list" class="kw-list"></div>
      <div class="input-wrapper">
        <input type="text" id="include-kw-input" placeholder="添加保留词..."/>
        <button id="add-include-kw-btn" class="add-kw-btn">添加</button>
      </div>
    </section>
    <section id="exclude-section">
      <h4 class="exclude">过滤关键词</h4>
      <div id="exclude-kw-list" class="kw-list"></div>
      <div class="input-wrapper">
        <input type="text" id="exclude-kw-input" placeholder="添加过滤词..."/>
        <button id="add-exclude-kw-btn" class="add-kw-btn">添加</button>
      </div>
    </section>
  `
  document.body.appendChild(panel)

  const expandBtn = document.createElement("button")
  expandBtn.className = "expand-btn"; expandBtn.textContent = "⚙️";
  document.body.appendChild(expandBtn)

  const minimizePanel = () => { panel.style.display = "none"; expandBtn.classList.add("show"); setPanelState("min") }
  const maximizePanel = () => { panel.style.display = "block"; expandBtn.classList.remove("show"); setPanelState("max") }

  panel.querySelector(".minimize-btn").onclick = minimizePanel
  expandBtn.onclick = maximizePanel
  if (getPanelState() === "min") minimizePanel()

  const filterToggle = panel.querySelector("#filter-toggle")
  filterToggle.checked = isFilterEnabled
  filterToggle.addEventListener("change", () => {
    isFilterEnabled = filterToggle.checked
    setFilterEnabled(isFilterEnabled)
    applyFilterToAll()
  })

  const renderList = (listDiv, keywords, onRemove) => {
    listDiv.innerHTML = ""
    keywords.forEach((kw, i) => {
      const row = document.createElement("div"); row.className = "kw";
      row.innerHTML = `<span>${kw}</span><button data-idx="${i}">✖</button>`;
      row.querySelector("button").onclick = () => onRemove(i);
      listDiv.appendChild(row)
    })
  }

  const setupInput = (inputEl, btnEl, onAdd) => {
    const addAction = () => {
      const kw = inputEl.value.trim()
      if (kw) { onAdd(kw); inputEl.value = ""; }
    }
    inputEl.addEventListener("keyup", e => { if (e.key === "Enter") addAction() })
    btnEl.addEventListener("click", addAction)
  }

  const includeListDiv = panel.querySelector("#include-kw-list"), includeInput = panel.querySelector("#include-kw-input"), addIncludeBtn = panel.querySelector("#add-include-kw-btn");
  const excludeListDiv = panel.querySelector("#exclude-kw-list"), excludeInput = panel.querySelector("#exclude-kw-input"), addExcludeBtn = panel.querySelector("#add-exclude-kw-btn");

  // --- 修改：添加关键词时检查重复变为大小写不敏感 ---
  const handleAddInclude = kw => {
      const lowerKw = kw.toLowerCase();
      const exists = includeKeywords.some(existing => existing.toLowerCase() === lowerKw);
      if (!exists) {
          includeKeywords.push(kw); // 存入原始输入，以保留大小写
          setIncludeKeywords(includeKeywords);
          renderList(includeListDiv, includeKeywords, handleRemoveInclude);
          applyFilterToAll();
      }
  }
  const handleRemoveInclude = i => { includeKeywords.splice(i, 1); setIncludeKeywords(includeKeywords); renderList(includeListDiv, includeKeywords, handleRemoveInclude); applyFilterToAll(); }
  setupInput(includeInput, addIncludeBtn, handleAddInclude); renderList(includeListDiv, includeKeywords, handleRemoveInclude);

  const handleAddExclude = kw => {
      const lowerKw = kw.toLowerCase();
      const exists = excludeKeywords.some(existing => existing.toLowerCase() === lowerKw);
      if (!exists) {
          excludeKeywords.push(kw);
          setExcludeKeywords(excludeKeywords);
          renderList(excludeListDiv, excludeKeywords, handleRemoveExclude);
          applyFilterToAll();
      }
  }
  const handleRemoveExclude = i => { excludeKeywords.splice(i, 1); setExcludeKeywords(excludeKeywords); renderList(excludeListDiv, excludeKeywords, handleRemoveExclude); applyFilterToAll(); }
  setupInput(excludeInput, addExcludeBtn, handleAddExclude); renderList(excludeListDiv, excludeKeywords, handleRemoveExclude);
}

buildPanel()
})()