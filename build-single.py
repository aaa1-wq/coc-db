#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包成 iOS 单文件 html：
- 把 data.js 内联进 index.html
- 把 data.js 里引用的本地图片(imgs/...jpg)转成 base64 内联
- 输出 single-ios.html（一个文件，iPhone Safari 直接打开就能看）
"""
import os
import re
import base64
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(ROOT, "index.html")
DATA = os.path.join(ROOT, "data.js")
OUT = os.path.join(ROOT, "single-ios.html")

def read(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read()

def to_data_url(path):
    ext = os.path.splitext(path)[1].lower()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
            ".webp": "image/webp", ".gif": "image/gif"}.get(ext, "image/jpeg")
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"

def main():
    print("读取 index.html 和 data.js ...")
    html = read(INDEX)
    js = read(DATA)

    # 1) 把 data.js 里所有 imgs/... 路径替换成 base64 data url
    print("内联本地图片（这步最慢，图多要等）...")
    # 匹配 imgs/xxx/yyy/zzz.jpg 形式（在 JSON 字符串里）
    pat = re.compile(r'imgs/[A-Za-z0-9_\-/]+\.(?:jpg|jpeg|png|webp|gif)', re.IGNORECASE)
    paths = set(pat.findall(js))
    print(f"  发现 {len(paths)} 张本地图片引用")

    cache = {}
    done = 0
    missing = 0
    def repl(m):
        nonlocal done, missing
        rel = m.group(0)
        if rel in cache:
            return cache[rel]
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.isfile(full):
            missing += 1
            cache[rel] = rel  # 找不到就保留原路径
            return rel
        du = to_data_url(full)
        cache[rel] = du
        done += 1
        if done % 50 == 0:
            print(f"    已处理 {done} 张...")
        return du

    js2 = pat.sub(repl, js)
    print(f"  完成：内联 {done} 张，缺失 {missing} 张")

    # 2) 把 <script src="data.js"></script> 换成内联 script
    # 用 JSON 安全方式：直接嵌入（data.js 里已经是 window.COC_DATA=...）
    inline_tag = "<script>\n" + js2 + "\n</script>"
    if '<script src="data.js"></script>' in html:
        html2 = html.replace('<script src="data.js"></script>', inline_tag)
    else:
        # 兜底：用正则
        html2 = re.sub(r'<script\s+src=["\']data\.js["\']\s*></script>', inline_tag, html)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html2)

    size_mb = os.path.getsize(OUT) / (1024 * 1024)
    print(f"\n✅ 已生成: {OUT}")
    print(f"   文件大小: {size_mb:.1f} MB")
    print("   把这个 single-ios.html 发到 iPhone，用 Safari/文件App 打开即可。")

if __name__ == "__main__":
    main()
