import requests
import time
import urllib.parse
from urllib.parse import urlparse
import os

# ================= 配置区域 =================

# 1. 本地 Clash 代理端口
PROXY_PORT = 7890

# 2. Clash API 设置
CLASH_API_URL = "http://127.0.0.1:9090"
CLASH_API_SECRET = "a0YcBKnR" 

# 3. 测速地址池
URL_OPTIONS = {
    "1": {
        "name": "DMM 视频流 (日本优化)",
        "url": "https://cc3001.dmm.co.jp/pv/KHYiQCINQ1k5qizjwUwcrp40YtyliqEbFA-WTLKJZLuTDns0IT2zrOtJ_4_ajQ69ebyf/118ftktabf288mhb.mp4"
    },
    "2": {
        "name": "GitHub Release (通用大文件)",
        "url": "https://github.com/AaronFeng753/Waifu2x-Extension-GUI/releases/download/v2.21.12/Waifu2x-Extension-GUI-v2.21.12-Portable.7z"
    }
}

# 4. 测速参数
TEST_SIZE_MB = 100  # 最大下载量
TEST_DURATION = 10  # 最大测速时长（秒）
TIMEOUT = 3

# 5. 保存路径
SAVE_DIR = r"C:\Users\cloudwayne\Documents\speedtest"
# RESULT_FILENAME 将在保存时动态生成（添加时间戳）

# ===========================================

def get_api_headers():
    headers = {"Content-Type": "application/json"}
    if CLASH_API_SECRET:
        headers["Authorization"] = f"Bearer {CLASH_API_SECRET}"
    return headers

# --- 功能函数 ---

def get_clash_mode():
    """获取当前 Clash 模式"""
    try:
        r = requests.get(f"{CLASH_API_URL}/configs", headers=get_api_headers(), timeout=2)
        return r.json().get('mode', 'Rule')
    except: return 'Rule'

def set_clash_mode(mode):
    """切换 Clash 模式"""
    try:
        requests.patch(f"{CLASH_API_URL}/configs", json={"mode": mode}, headers=get_api_headers(), timeout=2)
        print(f"⚙️ 系统模式已切换为: {mode}")
    except: pass

def get_proxy_groups():
    """获取所有策略组供用户选择"""
    try:
        r = requests.get(f"{CLASH_API_URL}/proxies", headers=get_api_headers())
        data = r.json().get('proxies', {})
        # 筛选出所有策略组类型（不只是 Selector）
        group_types = ['Selector', 'URLTest', 'Fallback', 'LoadBalance']
        groups = [k for k, v in data.items()
                  if v.get('type') in group_types and k not in ['GLOBAL', 'REJECT']]
        return groups
    except: return []

def get_nodes_in_group(group_name):
    """获取指定组内的节点"""
    try:
        url = f"{CLASH_API_URL}/proxies/{urllib.parse.quote(group_name)}"
        r = requests.get(url, headers=get_api_headers())
        return r.json().get('all', [])
    except: return []

def get_all_real_nodes():
    """获取所有真实节点（排除策略组和内置策略）"""
    try:
        r = requests.get(f"{CLASH_API_URL}/proxies", headers=get_api_headers())
        data = r.json().get('proxies', {})
        real_nodes = []
        # 排除策略组类型
        exclude_types = ['Selector', 'URL-Test', 'Fallback', 'Load-Balance', 'Direct', 'Reject', 'Relay', 'Compatible']
        # 排除 Mihomo 内置策略和常见无效节点
        exclude_names = ['DIRECT', 'REJECT', 'GLOBAL', 'PASS', 'Pass', 'COMPATIBLE']
        # 排除包含这些关键词的节点
        exclude_keywords = ['reject', 'drop', 'block', '广告', 'ad-', 'adblock']

        for name, detail in data.items():
            # 排除特定类型
            if detail['type'] in exclude_types:
                continue
            # 排除特定名称（不区分大小写）
            if name.upper() in [n.upper() for n in exclude_names]:
                continue
            # 排除包含特定关键词的节点（不区分大小写）
            if any(keyword.lower() in name.lower() for keyword in exclude_keywords):
                continue
            real_nodes.append(name)
        return real_nodes
    except: return []

def select_url():
    print("\n请选择测速地址:")
    print(f"1. {URL_OPTIONS['1']['name']}")
    print(f"2. {URL_OPTIONS['2']['name']}")
    print("3. 自定义 URL")

    c = input("输入序号 (默认1): ").strip()
    if c == '2': return URL_OPTIONS['2']['url']
    if c == '3': return input("输入URL: ").strip()
    return URL_OPTIONS['1']['url']

def switch_proxy(group, node):
    """切换节点"""
    try:
        url = f"{CLASH_API_URL}/proxies/{urllib.parse.quote(group)}"
        requests.put(url, json={"name": node}, headers=get_api_headers(), timeout=2)
        time.sleep(0.6) # 等待切换生效
    except: pass

def test_speed(node_name, url, current_idx=0, total=0):
    proxies = {"http": f"http://127.0.0.1:{PROXY_PORT}", "https": f"http://127.0.0.1:{PROXY_PORT}"}

    # 从 URL 提取 Referer
    parsed = urlparse(url)
    referer = f"{parsed.scheme}://{parsed.netloc}/"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive"
    }

    # 名称截断显示
    disp = (node_name[:25] + '..') if len(node_name)>25 else node_name
    # 进度前缀
    progress = f"[{current_idx}/{total}] " if total > 0 else ""
    print(f"{progress}测试 -> [{disp:<27}] ... ", end="", flush=True)

    try:
        start = time.time()
        with requests.get(url, proxies=proxies, headers=headers, stream=True, timeout=(TIMEOUT, TIMEOUT)) as r:
            if r.status_code == 403:
                print("⚠️ 403 Forbidden")
                return 0, "⚠️ 403 (地区限制)"
            if r.status_code != 200:
                print(f"❌ HTTP {r.status_code}")
                return 0, f"❌ HTTP {r.status_code}"

            downloaded = 0
            max_bytes = TEST_SIZE_MB * 1024 * 1024

            for chunk in r.iter_content(32768):
                if chunk:
                    downloaded += len(chunk)
                    elapsed = time.time() - start

                    # 实时显示速度
                    current_speed = (downloaded / 1024 / 1024) / elapsed if elapsed > 0 else 0
                    print(f"\r{progress}测试 -> [{disp:<27}] ... {current_speed:.1f} MB/s", end="", flush=True)

                    # 双重限制：达到时间上限或数据上限就停止
                    if elapsed >= TEST_DURATION or downloaded >= max_bytes:
                        break

            dur = time.time() - start
            if dur <= 0: dur = 0.01
            speed = (downloaded / 1024 / 1024) / dur

            status_str = ""
            if speed > 10:
                print(f"\r{progress}测试 -> [{disp:<27}] ... 🚀 {speed:.2f} MB/s")
                status_str = f"🚀 **{speed:.2f} MB/s**"
            elif speed > 3:
                print(f"\r{progress}测试 -> [{disp:<27}] ... ✅ {speed:.2f} MB/s")
                status_str = f"✅ {speed:.2f} MB/s"
            else:
                print(f"\r{progress}测试 -> [{disp:<27}] ... 🐢 {speed:.2f} MB/s")
                status_str = f"🐢 {speed:.2f} MB/s"

            return speed, status_str
    except requests.exceptions.Timeout:
        print(f"\r{progress}测试 -> [{disp:<27}] ... ❌ 超时")
        return 0, "❌ 超时 Timeout"
    except:
        print(f"\r{progress}测试 -> [{disp:<27}] ... ❌ 失败")
        return 0, "❌ 连接失败 Error"

def save_markdown(results, title_info):
    try:
        if not os.path.exists(SAVE_DIR): os.makedirs(SAVE_DIR)
        # 生成带时间戳的文件名
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        filename = f"speed_results_{timestamp}.md"
        path = os.path.join(SAVE_DIR, filename)
        
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# {title_info['title']}\n\n")
            f.write(f"- **测试时间**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"- **测试模式**: {title_info['mode']}\n")
            f.write(f"- **节点总数**: {len(results)}\n\n")
            f.write("| 排名 | 节点名称 | 速度 / 状态 |\n")
            f.write("| :--- | :--- | :--- |\n")
            
            for i, r in enumerate(results):
                safe_name = r['node'].replace("|", "\|")
                f.write(f"| {i+1} | {safe_name} | {r['msg']} |\n")
        
        print(f"\n💾 结果已保存至: {path}")
        try: os.startfile(SAVE_DIR)
        except: pass
    except Exception as e:
        print(f"保存失败: {e}")

# ================= 主逻辑 =================

def main():
    print("--- Clash 测速工具 Pro ---\n")
    
    # 1. 选择测速模式
    print("请选择测速范围:")
    print("[1] 指定代理组 (例如: 只测 '日本' 组)")
    print("[2] 全节点暴力测速 (扫描所有节点 + 强制 Global)")
    mode_choice = input("\n输入序号: ").strip()
    
    target_nodes = []
    op_group = ""      # 操作的目标组
    is_global_test = False
    
    if mode_choice == '2':
        # 全节点模式
        is_global_test = True
        op_group = "GLOBAL"
        target_nodes = get_all_real_nodes()
        if not target_nodes:
            print("❌ 未找到节点。")
            return
    else:
        # 组模式
        groups = get_proxy_groups()
        if not groups:
            print("❌ 未找到策略组。")
            return
        print("\n可用策略组:")
        for i, g in enumerate(groups):
            print(f"{i+1}. {g}")
        
        try:
            g_idx = int(input("\n选择组序号: ")) - 1
            if g_idx < 0 or g_idx >= len(groups):
                print("❌ 序号超出范围")
                return
            op_group = groups[g_idx]
            target_nodes = get_nodes_in_group(op_group)
            # 简单的过滤
            filter_list = ["DIRECT", "REJECT", "自动", "Auto", "故障"]
            target_nodes = [n for n in target_nodes if not any(x in n for x in filter_list)]
        except:
            print("输入错误")
            return

    print(f"\n已选目标: {op_group} | 待测节点: {len(target_nodes)} 个")
    
    # 2. 选择 URL
    target_url = select_url()
    
    # 3. 准备环境 (如果全量测速，切换 Global)
    origin_mode = get_clash_mode()
    if is_global_test and origin_mode != "Global":
        print("\n⏳ 正在切换至 Global 模式以确保准确...")
        set_clash_mode("Global")
        time.sleep(1)

    # 4. 开始测速
    results = []
    total_nodes = len(target_nodes)
    print("-" * 50)
    try:
        for idx, node in enumerate(target_nodes, 1):
            switch_proxy(op_group, node)
            s, m = test_speed(node, target_url, idx, total_nodes)
            results.append({"node": node, "speed": s, "msg": m})
    except KeyboardInterrupt:
        print("\n⚠️ 用户中断")
    finally:
        # 测速完成后自动恢复为 Rule 模式
        current_mode = get_clash_mode()
        if current_mode != "Rule":
            print("-" * 50)
            print(f"🔄 正在恢复 Clash 模式为: Rule ...")
            set_clash_mode("Rule")

    # 5. 保存
    results.sort(key=lambda x: x['speed'], reverse=True)
    
    title_info = {
        "title": "Clash 全节点测速报告" if is_global_test else f"Clash 分组测速报告 ({op_group})",
        "mode": "Global (强制全局)" if is_global_test else f"Rule (分组: {op_group})"
    }
    
    save_markdown(results, title_info)

if __name__ == "__main__":
    main()