# -*- coding: utf-8 -*-
"""《周礼》语料库检索工具（命令行）。

用法：
    python scripts\\zhouli.py stats
    python scripts\\zhouli.py search 大宰 [--篇 天官冢宰] [--limit 20] [--json] [--regex]
    python scripts\\zhouli.py zhiguan --list [--篇 天官冢宰]
    python scripts\\zhouli.py zhiguan 大宰
    python scripts\\zhouli.py chapter 天官冢宰 [--limit 40]
    python scripts\\zhouli.py para 1.1
    python scripts\\zhouli.py staff 天官冢宰
    python scripts\\zhouli.py jiaokan [--篇 天官冢宰] [--witness 白文] [--kind 异文] [--limit 40]

数据来自 data/*.json（与 dsh-zhouli 插件共用的同一份语料），仅依赖标准库。
"""
import argparse
import json
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STRUCT = os.path.join(ROOT, "data")


def load(name):
    path = os.path.join(STRUCT, name)
    if not os.path.exists(path):
        sys.exit("缺少数据文件：%s\n请先运行：python scripts\\build_corpus.py" % path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve_chapter(data, key):
    """按篇名 / 序号 / 简体篇名定位篇。"""
    if not key:
        return None
    for ch in data["篇"]:
        if key in (ch["篇名"], ch["简体篇名"], str(ch["序号"])):
            return ch
    for ch in data["篇"]:
        if key in ch["篇名"] or key in ch["简体篇名"]:
            return ch
    sys.exit("找不到篇目：%s（可用：%s）"
             % (key, "、".join(c["篇名"] for c in data["篇"])))


def chapter_filter(query, data, keyname):
    """按用户给出的篇名（繁简皆可）构造过滤函数，作用于 keyname 指定的字段。"""
    if not query:
        return lambda name: True
    ch = resolve_chapter(data, query)
    return lambda name: name == ch[keyname]


def snippet(text, start, end, pad=16):
    lo, hi = max(0, start - pad), min(len(text), end + pad)
    return ("…" if lo else "") + text[lo:start] + "【" + text[start:end] + "】" \
           + text[end:hi] + ("…" if hi < len(text) else "")


# --------------------------------------------------------------------------
def cmd_stats(args):
    st = load("stats.json")
    print("《周礼》语料库统计")
    print("  底本：%s（%s）" % (st["底本"]["来源"], st["底本"]["授权"]))
    print("  底本汉字数：%d    篇数：%d    段数：%d    职官数：%d（去重 %d）"
          % (st["底本汉字数"], st["篇数"], st["段数"], st["职官数"], st["职官去重数"]))
    print("\n  每篇：")
    for name, v in st["每篇"].items():
        print("    %-8s 字 %-6d 段 %-4d 职官 %-3d" % (name, v["字数"], v["段数"], v["职官数"]))
    print("\n  目次与正文：")
    for name, v in st["目次与正文差异"].items():
        print("    %-8s 目次 %-3d 正文段 %-3d 目次有正文无=%-6s 正文有目次无=%s"
              % (name, v["目次条数"], v["正文段数"],
                 v["目次有正文无"] or "无", v["正文有目次无"] or "无"))
    print("\n  校勘事件数（底本 vs 各校本）：")
    for ch, d in st["校勘事件数"].items():
        print("    %-8s %s" % (ch, "  ".join("%s=%d" % (k, v) for k, v in d.items())))


def find_spans(text, pattern, use_regex):
    if use_regex:
        return [(m.start(), m.end()) for m in re.finditer(pattern, text)]
    spans, start = [], 0
    while True:
        i = text.find(pattern, start)
        if i < 0:
            return spans
        spans.append((i, i + len(pattern)))
        start = i + 1


def cmd_search(args):
    data = load("zhouli.json")
    ch = resolve_chapter(data, args.篇)
    hits = []
    for c in data["篇"]:
        if ch and c["篇名"] != ch["篇名"]:
            continue
        for p in c["段落"]:
            # 繁体优先；繁体未命中再退回简体，避免同一处重复计数
            spans = find_spans(p["繁体"], args.关键词, args.regex)
            if spans:
                hits.extend((c, p, "繁体", s, e) for s, e in spans)
                continue
            spans = find_spans(p["简体"], args.关键词, args.regex)
            hits.extend((c, p, "简体", s, e) for s, e in spans)
    if args.json:
        print(json.dumps([{"篇": c["篇名"], "篇序": c["序号"], "段序": p["段序"],
                           "职官序": p["职官序"], "字段": f, "起": s, "止": e,
                           "文": p["繁体"]}
                          for c, p, f, s, e in hits[:args.limit]], ensure_ascii=False, indent=2))
        return
    print("命中 %d 处（显示前 %d）" % (len(hits), min(len(hits), args.limit)))
    for c, p, f, s, e in hits[:args.limit]:
        mark = "" if f == "繁体" else "（简体文匹配）"
        print("\n[%s第%d §%d 段 职官序%s]%s"
              % (c["篇名"], c["序号"], p["段序"], p["职官序"], mark))
        print("  " + snippet(p[f], s, e))


def cmd_zhiguan(args):
    zg = load("zhiguan.json")
    if args.list:
        data = load("zhouli.json")
        keep = chapter_filter(args.篇, data, "篇名")
        items = [i for i in zg["职官"] if any(keep(x) for x in i["篇"])]
        print("职官 %d 个：" % len(items))
        for i in items:
            print("  %-8s %s" % (i["职官"], "、".join(i["篇"])))
        return
    if not args.名称:
        sys.exit("请给出职官名，或使用 --list")
    hits = [i for i in zg["职官"] if args.名称 in i["职官"]]
    if not hits:
        print("未找到职官：%s" % args.名称)
        return
    for i in hits:
        print("=" * 66)
        print("职官：%s（简体 %s）    所属：%s" % (i["职官"], i["简体"], "、".join(i["篇"])))
        for e in i["条目"]:
            print("\n  【%s第%d %d.%d】" % (e["篇"], e["篇序"], e["篇序"], e["职官序"]))
            print("    员额：%s" % (e["员额"] or "（未见于叙官）"))
            print("    职掌：%s" % e["职掌"])
            if e["取名方式"] != "一致":
                print("    ※ %s" % e["取名方式"])


def cmd_chapter(args):
    data = load("zhouli.json")
    ch = resolve_chapter(data, args.篇名)
    print("《周礼》%s第%d    汉字 %d    段 %d    职官 %d\n"
          % (ch["篇名"], ch["序号"], ch["汉字数"], ch["段数"], ch["职官数"]))
    for p in ch["段落"][:args.limit]:
        print("§%-3d %d.%-3d %s" % (p["段序"], ch["序号"], p["职官序"], p["繁体"]))
    if ch["段数"] > args.limit:
        print("\n… 余下 %d 段，用 --limit 调整" % (ch["段数"] - args.limit))


def cmd_para(args):
    data = load("zhouli.json")
    key = args.定位
    m = re.match(r"^(\d+)\.(\d+)$", key)
    if m:
        ch = resolve_chapter(data, m.group(1))
        want = int(m.group(2))
        for p in ch["段落"]:
            if p["职官序"] == want:
                print("%s第%d  §%d  职官序 %d" % (ch["篇名"], ch["序号"], p["段序"], p["职官序"]))
                print("\n繁体：%s" % p["繁体"])
                print("\n简体：%s" % p["简体"])
                return
        sys.exit("在%s中未找到职官序 %d" % (ch["篇名"], want))
    if key.isdigit():
        for c in data["篇"]:
            for p in c["段落"]:
                if p["段序"] == int(key):
                    print("%s第%d  §%d" % (c["篇名"], c["序号"], p["段序"]))
                    print("\n繁体：%s\n\n简体：%s" % (p["繁体"], p["简体"]))
                    return
    sys.exit("定位格式应为「篇序.职官序」（如 1.1）或段序数字")


def cmd_staff(args):
    data = load("zhouli.json")
    ch = resolve_chapter(data, args.篇名)
    print("《周礼》%s第%d  叙官（员额编制，共 %d 职官）\n" % (ch["篇名"], ch["序号"], ch["职官数"]))
    print(ch["叙官"][:2000])
    print("\n" + "-" * 66)
    for o in ch["职官"]:
        print("  %2d. %-8s %s" % (o["序号"], o["职官"], o["员额"] or "（叙官未见）"))


def cmd_jiaokan(args):
    jk = load("jiaokan.json")
    keep = chapter_filter(args.篇, load("zhouli.json"), "篇名")
    total = 0
    for name, entry in jk.items():
        if not keep(name):
            continue
        for tag, blk in entry.items():
            if args.witness and args.witness != tag:
                continue
            evs = blk["事件"]
            if args.kind:
                evs = [e for e in evs if e["kind"] == args.kind]
            if not evs:
                continue
            print("\n===== %s  vs  %s    锚点 %d    事件 %d ====="
                  % (name, tag, blk["锚点数"], blk["事件数"]))
            for e in evs[:args.limit]:
                print("  [%s] …%s⟨%s⟩→⟨%s⟩%s…"
                      % (e["kind"], e["上接"], e["底本"], e["异本"], e["下接"]))
                total += 1
    print("\n合计显示 %d 条" % total)


def main():
    ap = argparse.ArgumentParser(prog="zhouli", description="《周礼》语料库检索工具")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("stats", help="统计概览").set_defaults(func=cmd_stats)

    p = sub.add_parser("search", help="全文检索")
    p.add_argument("关键词")
    p.add_argument("--篇", default=None)
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--regex", action="store_true")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("zhiguan", help="职官查询")
    p.add_argument("名称", nargs="?")
    p.add_argument("--list", action="store_true")
    p.add_argument("--篇", default=None)
    p.set_defaults(func=cmd_zhiguan)

    p = sub.add_parser("chapter", help="按篇浏览")
    p.add_argument("篇名")
    p.add_argument("--limit", type=int, default=40)
    p.set_defaults(func=cmd_chapter)

    p = sub.add_parser("para", help="看某段（如 1.1 或 段序）")
    p.add_argument("定位")
    p.set_defaults(func=cmd_para)

    p = sub.add_parser("staff", help="叙官与员额编制")
    p.add_argument("篇名")
    p.set_defaults(func=cmd_staff)

    p = sub.add_parser("jiaokan", help="校勘记")
    p.add_argument("--篇", default=None)
    p.add_argument("--witness", default=None, choices=["郑玄注本", "白文", "注疏"])
    p.add_argument("--kind", default=None,
                   choices=["异文", "底本多出", "底本阙", "段序错位"])
    p.add_argument("--limit", type=int, default=40)
    p.set_defaults(func=cmd_jiaokan)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
