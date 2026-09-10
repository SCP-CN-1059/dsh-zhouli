# -*- coding: utf-8 -*-
"""采集《周礼》语料库所需的原始素材。

默认只取 Kanripo（漢籍リポジトリ）的两种底本 — 它们是 CC BY-SA 4.0，本仓库
据此分发 `data/` 下的语料：

    kanripo/KR1d0001  《周禮》正文（6 卷文件 + 逐職官目次 Readme.org）
    kanripo/KR1d0002  《周禮》鄭玄注（四部叢刊本，12 卷文件）

加 --with-daizhige 会额外取殆知阁古代文献的白文与周礼注疏两种校本。

    !! 该上游仓库未声明任何许可证。本仓库不分发它们，也不分发由它们派生的
       校勘结果；加上该选项属于你为本地自用而作的决定。详见 NOTICE。
    !! 该白文本含若干明显讹字（如 建宫以捂 / 疱人 / 胥信人），只适合用于
       互校，不宜单独据以引证。

用法：
    python scripts\\fetch_corpus.py [--force] [--with-daizhige]

设计：只取所需文件（Kanripo 约 21 个），带 UA 标识，文件间间隔 0.5 秒；
     已有且非空的文件默认跳过。
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
UA = "dsh-zhouli/0.1 (corpus fetch; Kanripo open corpus user)"
DELAY = 0.5
RETRIES = 4

REPOS = ["KR1d0001", "KR1d0002"]

# 殆知阁古代文献（仓库未声明许可证）——仅在 --with-daizhige 时取用。
DAIZHIGE_BASE = "https://raw.githubusercontent.com/garychowcmu/daizhigev20/master/"
DAIZHIGE_FILES = ["儒藏/礼经/周礼.txt", "儒藏/礼经/周礼注疏.txt"]


def list_tree(repo):
    """返回仓库中全部 blob 路径。"""
    api = "https://api.github.com/repos/kanripo/%s" % repo
    req = urllib.request.Request(api, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        branch = json.loads(r.read()).get("default_branch", "master")
    url = "https://api.github.com/repos/kanripo/%s/git/trees/%s?recursive=1" % (repo, branch)
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                tree = json.loads(r.read())
            return branch, [x["path"] for x in tree.get("tree", []) if x["type"] == "blob"]
        except Exception:
            if attempt == RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))


def download(repo, branch, path, dest, force=False):
    if os.path.exists(dest) and not force and os.path.getsize(dest) > 0:
        return "cached", os.path.getsize(dest)
    url = "https://raw.githubusercontent.com/kanripo/%s/%s/%s" % (
        repo, branch, urllib.parse.quote(path))
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if not data:
                raise IOError("empty response")
            tmp = dest + ".part"
            with open(tmp, "wb") as w:
                w.write(data)
            os.replace(tmp, dest)
            return "fetched", len(data)
        except Exception as exc:                       # noqa: BLE001
            if attempt == RETRIES - 1:
                return "FAILED: %s" % exc, 0
            time.sleep(1.5 * (attempt + 1))
    return "FAILED", 0


def fetch_url(url, dest, force=False):
    """带重试地取一个 URL 到 dest；返回 (状态, 字节数)。"""
    if os.path.exists(dest) and not force and os.path.getsize(dest) > 0:
        return "cached", os.path.getsize(dest)
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if not data:
                raise IOError("empty response")
            tmp = dest + ".part"
            with open(tmp, "wb") as w:
                w.write(data)
            os.replace(tmp, dest)
            return "fetched", len(data)
        except Exception as exc:                       # noqa: BLE001
            if attempt == RETRIES - 1:
                return "FAILED: %s" % exc, 0
            time.sleep(1.5 * (attempt + 1))
    return "FAILED", 0


def fetch_daizhige(force):
    """取殆知阁的两种校本，落在 data/raw/ 下与 build_corpus.py 约定的文件名。"""
    print("\n--with-daizhige：取殆知阁校本（上游未声明许可证，仅限本地自用）")
    results = []
    for rel in DAIZHIGE_FILES:
        url = DAIZHIGE_BASE + urllib.parse.quote(rel)
        dest = os.path.join(RAW, os.path.basename(rel))
        status, size = fetch_url(url, dest, force=force)
        results.append((rel, status, size))
        print("  %-30s %-12s %8d" % (os.path.basename(rel), status, size))
        if status == "fetched":
            time.sleep(DELAY)
    return results


def main():
    ap = argparse.ArgumentParser(description="采集《周礼》语料库原始素材")
    ap.add_argument("-Force", "--force", action="store_true", help="忽略缓存强制重抓")
    ap.add_argument("--with-daizhige", action="store_true",
                    help="额外取殆知阁白文/注疏（上游无许可证声明，仅限本地自用；见 NOTICE）")
    args = ap.parse_args()

    results = []
    for repo in REPOS:
        dest_dir = os.path.join(RAW, "kanripo", repo)
        os.makedirs(dest_dir, exist_ok=True)
        branch, paths = list_tree(repo)
        wanted = [p for p in paths if p.endswith((".txt", ".org"))]
        print("%s（branch=%s）共 %d 个文件待取" % (repo, branch, len(wanted)))
        for path in sorted(wanted):
            dest = os.path.join(dest_dir, os.path.basename(path))
            status, size = download(repo, branch, path, dest, force=args.force)
            results.append((repo, path, status, size))
            print("  %-30s %-12s %8d" % (path, status, size))
            if status == "fetched":
                time.sleep(DELAY)

    ok = sum(1 for r in results if r[2] in ("cached", "fetched"))
    print("\nKanripo：%d/%d 个文件就绪" % (ok, len(results)))

    dz_ok = True
    if args.with_daizhige:
        dz = fetch_daizhige(args.force)
        dz_ok = all(r[1] in ("cached", "fetched") for r in dz)

    if ok != len(results):
        return 1
    return 0 if dz_ok else 1


if __name__ == "__main__":
    sys.exit(main())
