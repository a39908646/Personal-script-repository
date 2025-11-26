# -*- coding: utf-8 -*-
import subprocess
import os
import re
from pathlib import Path
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
import traceback

# --- 用户配置区 ---

# 1. 视频目录 (请修改为您自己的路径)
VIDEO_DIR = r"C:\remux"

# 2. 要从文件名中移除的文字
TEXT_TO_REMOVE = " Chinese homemade video"

# 3. 并行线程数 (建议不要超过 CPU 核心数的一半，因为 ffmpeg 很耗 CPU)
MAX_WORKERS = 4

# --- 脚本功能模块 (通常无需修改) ---

# 创建一个日志文件来记录详细的ffmpeg错误
LOG_FILE = Path(__file__).parent / "ffmpeg_error_log.txt"
if LOG_FILE.exists():
    LOG_FILE.unlink() # 每次运行时清空旧日志

def rename_files_in_dir(directory):
    """步骤一：递归遍历指定目录，移除文件名中的特定字符串。"""
    print("--- 步骤 1: 开始批量重命名文件 ---")
    print(f"目标文件夹: {directory}")
    print(f"将要移除的文字: '{TEXT_TO_REMOVE}'\n")
    
    paths_to_rename = [p for p in Path(directory).rglob(f"*{TEXT_TO_REMOVE}*") if p.is_file()]
    
    if not paths_to_rename:
        print("没有找到包含指定文字的文件名，跳过重命名步骤。")
        return

    for path_obj in tqdm(paths_to_rename, desc="重命名进度", unit="个文件"):
        try:
            new_name = path_obj.name.replace(TEXT_TO_REMOVE, "")
            new_path = path_obj.with_name(new_name)
            if not new_path.exists():
                path_obj.rename(new_path)
            else:
                tqdm.write(f"警告: 跳过 '{path_obj.name}'，目标 '{new_name}' 已存在。")
        except Exception as e:
            tqdm.write(f"错误: 重命名 '{path_obj.name}' 时发生错误: {e}")
                
    print(f"\n重命名完成，共处理了 {len(paths_to_rename)} 个文件。")

def get_video_duration(file_path):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)],
            capture_output=True, text=True, check=True
        )
        return float(result.stdout.strip())
    except (subprocess.CalledProcessError, ValueError):
        return None

def parse_time_to_seconds(time_str):
    parts = time_str.split(':')
    seconds = float(parts[2])
    minutes = int(parts[1]) * 60
    hours = int(parts[0]) * 3600
    return hours + minutes + seconds

def needs_faststart(file_path):
    """检查 MP4 文件的 moov 是否在 mdat 后面"""
    if file_path.suffix.lower() != '.mp4':
        return False
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "trace", str(file_path)],
            capture_output=True, text=True, encoding='utf-8', errors='ignore'
        )
        stderr = result.stderr
        moov_pos = stderr.find("type:'moov'")
        mdat_pos = stderr.find("type:'mdat'")
        if moov_pos == -1 or mdat_pos == -1:
            return False
        return mdat_pos < moov_pos  # mdat 在前说明 moov 在后，需要优化
    except Exception:
        return False

def remux_with_progress(file_path, position, reason=""):
    output_path = file_path.with_suffix(".mkv")
    tmp_file = output_path.with_suffix(".mkv.tmp")
    duration = get_video_duration(file_path)
    display_name = file_path.name if len(file_path.name) < 40 else "..." + file_path.name[-37:]
    
    cmd = ["ffmpeg", "-y", "-i", str(file_path), "-c", "copy", 
           "-map", "0",
           "-map", "-0:d",
           "-f", "matroska", 
           "-metadata", "repaired_by=ffmpeg", str(tmp_file)]
    
    try:
        process = subprocess.Popen(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                   universal_newlines=True, encoding='utf-8', errors='ignore')
        
        pbar_desc = f"转换中: {display_name}"
        
        if duration:
            pbar = tqdm(total=int(duration), desc=pbar_desc, position=position, unit='s', leave=False, bar_format='{l_bar}{bar}| {n_fmt}/{total_fmt}')
        else:
            pbar = tqdm(desc=pbar_desc, position=position, bar_format='{l_bar}{bar}|', leave=False)

        time_pattern = re.compile(r"time=(\d{2}:\d{2}:\d{2}\.\d{2})")
        
        stderr_output = ""
        last_time = 0
        for line in process.stderr:
            stderr_output += line
            if duration:
                match = time_pattern.search(line)
                if match:
                    current_time = parse_time_to_seconds(match.group(1))
                    update_amount = current_time - last_time
                    if update_amount > 0:
                        pbar.update(update_amount)
                        last_time = current_time
        
        if duration and pbar.n < pbar.total:
            pbar.update(pbar.total - pbar.n)

        pbar.close()
        process.wait()

        if process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, cmd, stderr=stderr_output)

        os.replace(str(tmp_file), str(output_path))

        if file_path.resolve() != output_path.resolve():
            file_path.unlink()
            return f"✅ {reason}转为MKV: {file_path.name} -> {output_path.name}"
        else:
            return f"✅ 已覆盖修复: {file_path.name}"

    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        if tmp_file.exists(): tmp_file.unlink()
        
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("="*80 + "\n")
            f.write(f"文件处理失败: {file_path}\n")
            f.write(f"执行的命令: {' '.join(cmd)}\n")
            if isinstance(e, subprocess.CalledProcessError):
                f.write("--- FFmpeg 完整错误输出 ---\n")
                f.write(e.stderr)
            else:
                f.write("--- Python 异常信息 ---\n")
                f.write(traceback.format_exc())
            f.write("="*80 + "\n\n")

        return f"❌ remux 失败: {file_path.name} (详情见 ffmpeg_error_log.txt)"

def is_repaired(file_path):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format_tags=repaired_by",
             "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)],
            capture_output=True, text=True, check=True, encoding='utf-8', errors='ignore'
        )
        return "ffmpeg" in result.stdout
    except Exception:
        return False

def is_broken(file_path):
    try:
        process = subprocess.run(
            ["ffprobe", str(file_path)],
            capture_output=True, text=True, check=False,
            encoding='utf-8', errors='ignore'
        )
        log_output = process.stderr.lower()
        broken_keywords = [
            "moov atom not found", "non-monotonous dts", "invalid data found when processing input",
            "error reading trailer", "could not find codec parameters", "missing picture in access unit",
        ]
        if process.returncode != 0: return True
        if any(keyword in log_output for keyword in broken_keywords): return True
        return False
    except FileNotFoundError:
        print("\n\n致命错误: ffprobe 命令未找到。请确保 ffmpeg 已安装并已添加到系统 PATH 环境变量中。\n")
        raise
    except Exception as e:
        tqdm.write(f"警告: 检查 '{file_path.name}' 时发生未知错误: {e}。将尝试修复。")
        return True

def process_file(file_path, position):
    # 检查是否已有对应的 MKV 版本（针对 TS/MP4 文件）
    if file_path.suffix.lower() in ['.ts', '.mp4']:
        mkv_version = file_path.with_suffix(".mkv")
        if mkv_version.exists() and is_repaired(mkv_version):
             return f"⏩ 已转为MKV，跳过原文件: {file_path.name}"
    
    # 检查是否已修复过
    if is_repaired(file_path):
        return f"⏩ 已修复过，跳过: {file_path.name}"
    
    # TS 文件强制重新封装
    if file_path.suffix.lower() == '.ts':
        tqdm.write(f"ℹ️ 检测到TS文件，将重新封装: {file_path.name}")
        return remux_with_progress(file_path, position, "TS文件")
    
    # MP4 文件检查 moov 位置
    if file_path.suffix.lower() == '.mp4' and needs_faststart(file_path):
        tqdm.write(f"ℹ️ 检测到 moov 在文件末尾，将重新封装: {file_path.name}")
        return remux_with_progress(file_path, position, "moov优化")
    
    # 检查是否损坏
    if is_broken(file_path):
        return remux_with_progress(file_path, position, "修复损坏")
    
    return f"✅ 正常，无需处理: {file_path.name}"

# --- 主程序执行区 ---
if __name__ == "__main__":
    rename_files_in_dir(VIDEO_DIR)
    print("\n" + "="*50 + "\n")
    print("--- 步骤 2: 开始检查并修复视频文件 ---")
    if not Path(VIDEO_DIR).exists():
        print(f"致命错误: 目录 '{VIDEO_DIR}' 不存在！请检查您的配置。")
    else:
        video_files = []
        extensions = ["*.[mM][pP]4", "*.[mM][kK][vV]", "*.[tT][sS]"]
        for ext in extensions:
            video_files.extend(Path(VIDEO_DIR).rglob(ext))
        
        if not video_files:
            print("在指定目录中没有找到 .mp4, .mkv 或 .ts 文件。")
        else:
            results = []
            with tqdm(total=len(video_files), desc="总体进度", position=0, unit="个视频") as main_pbar:
                with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                    futures = {
                        executor.submit(process_file, file, i + 1): file 
                        for i, file in enumerate(video_files)
                    }
                    
                    for future in as_completed(futures):
                        try:
                            result = future.result()
                            results.append(result)
                        except Exception as e:
                            file = futures[future]
                            error_details = f"CRITICAL ERROR processing {file.name}: {e}\n{traceback.format_exc()}"
                            results.append(error_details)
                            with open(LOG_FILE, "a", encoding="utf-8") as f:
                                 f.write(error_details)
                        finally:
                            main_pbar.update(1)

            print("\n\n--- 修复结果报告 ---")
            results.sort()
            for r in results:
                print(r)
            if LOG_FILE.exists() and LOG_FILE.read_text():
                 print(f"\n⚠️ 检测到错误！详细信息已记录在日志文件中: {LOG_FILE}")

    print("\n🎉 全部处理完成！")
    input("\n按回车键退出...")