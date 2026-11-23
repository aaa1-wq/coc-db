#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
COC 阵型截图助手（半自动）
用法：
  python auto-shot.py            # 启动 COC，等你点好阵型后按回车截图
  python auto-shot.py 阵型名      # 同上，截图存成该名字

流程：
  1. 脚本用 googleplaygames 协议启动 Clash of Clans
  2. 等你在游戏里导入/摆好阵型
  3. 回到这个命令行窗口按【回车】→ 自动截全屏存图
  4. 截图保存在 shots/ 目录（同名自动加序号）
"""
import sys
import os
import time
import subprocess

# 强制控制台 UTF-8，避免中文 print 报 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

try:
    import pyautogui
    from PIL import ImageGrab
except ImportError:
    print("缺少依赖，请先运行:  pip install pyautogui pillow")
    sys.exit(1)

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOT_DIR = os.path.join(ROOT, "shots")
os.makedirs(SHOT_DIR, exist_ok=True)

COC_PROTOCOL = "googleplaygames://launch/?id=com.supercell.clashofclans&lid=2&pid=1"

def launch_coc():
    print("[1/3] 正在启动 Clash of Clans ...")
    try:
        # 用系统协议启动（会唤起 Google Play Games 里的 COC）
        os.startfile(COC_PROTOCOL)
    except Exception:
        subprocess.Popen(["cmd", "/c", "start", "", COC_PROTOCOL], shell=False)
    print("      已发送启动指令。游戏窗口可能需要几秒到几十秒加载。")

def safe_name(name):
    bad = '\\/:*?"<>|'
    for c in bad:
        name = name.replace(c, "_")
    return name.strip() or "阵型"

def take_shot(name):
    # 截全屏
    img = ImageGrab.grab()
    base = safe_name(name)
    fn = os.path.join(SHOT_DIR, f"{base}.png")
    i = 1
    while os.path.exists(fn):
        fn = os.path.join(SHOT_DIR, f"{base}_{i}.png")
        i += 1
    img.save(fn)
    print(f"      ✅ 已保存截图: {fn}")
    return fn

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "阵型"
    print("=" * 50)
    print("  COC 阵型截图助手（半自动）")
    print("=" * 50)

    # 是否已启动？给个选择
    ans = input("要现在自动启动 COC 吗？(y=启动 / n=已经开着): ").strip().lower()
    if ans != "n":
        launch_coc()
    else:
        print("[1/3] 跳过启动，使用已打开的 COC。")

    print("\n[2/3] 请切到 COC，导入并摆好你要截图的阵型。")
    print("      摆好后回到这个窗口，按【回车】截图。")
    input("      >>> 摆好后按回车截图...")

    print("[3/3] 截图...")
    time.sleep(0.6)  # 给窗口切换留点时间
    fn = take_shot(name)

    # 可选：再来一张
    while True:
        again = input("\n还要再截一张吗？(回车=退出 / 输入新名字=再截一张): ").strip()
        if not again:
            break
        input("      摆好新的阵型后按回车...")
        time.sleep(0.6)
        take_shot(again)

    print(f"\n完成！截图都在: {SHOT_DIR}")
    print("去阵型库里用「上传截图补图」把图配上即可。")

if __name__ == "__main__":
    main()
