# -*- coding: utf-8 -*-
"""构建《周礼》结构化语料库。

底本（Kanripo 漢籍リポジトリ，CC BY-SA 4.0 —— 见 NOTICE）
    data/raw/kanripo/KR1d0001/   周禮 正文（6 卷，mandoku 标记）
    data/raw/kanripo/KR1d0001/Readme.org  逐職官目次
校本（Kanripo，CC BY-SA 4.0）
    data/raw/kanripo/KR1d0002/   周禮 鄭玄注（四部叢刊本，12 卷，注文以 () 括注）

以下两类校本**默认不参与**：它们的上游仓库未声明任何许可证，本仓库不分发
它们，也不分发由它们派生的校勘结果。用 fetch_corpus.py --with-daizhige 取到
本地后，再直接运行本脚本即可把它们并入（--kanripo-only 可强制排除）：

    data/raw/周礼.txt            殆知阁古代文献 白文（简体）
    data/raw/周礼注疏.txt        殆知阁古代文献 周礼注疏（简体）

产出
    data/text/*.txt                人可读纯文本
    data/zhouli.json               主数据：篇 → 职官 → 段（dsh-zhouli 插件读取）
    data/zhiguan.json              职官索引
    data/jiaokan.json              校勘记
    data/stats.json                统计
    data/_build_report.txt         构建日志

用法：
    python scripts\\build_corpus.py [--kanripo-only]

依赖：pip install zhconv
"""
import json
import os
import re
import sys
import unicodedata
from collections import OrderedDict

import zhconv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
K1 = os.path.join(RAW, "kanripo", "KR1d0001")
K2 = os.path.join(RAW, "kanripo", "KR1d0002")
TEXT = os.path.join(ROOT, "data", "text")
# 四个 JSON 直接落在 data/ 下 —— 那正是 dsh-zhouli 插件读取的目录（见 lib/index.js），
# 插件也可用 config.dataDir 指向别处。
STRUCT = os.path.join(ROOT, "data")

# 殆知阁校本的原始文件位置（默认不参与构建，见模块 docstring 与 NOTICE）。
PLAIN_RAW = os.path.join(RAW, "周礼.txt")
ZHUSHU_RAW = os.path.join(RAW, "周礼注疏.txt")
# 由 --kanripo-only 置位：只使用 CC BY-SA 4.0 的两个 Kanripo 校本。
KANRIPO_ONLY = False

CHAPTER_NAMES = ["天官冢宰", "地官司徒", "春官宗伯", "夏官司馬", "秋官司寇", "冬官考工記"]
# 底本六卷序号与 Kanripo 文件编号一致（001..006）
# 郑玄注本 12 卷：每篇上下两卷
K2_FILE_PAIRS = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12)]

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003ffff]")
PB = re.compile(r"^(?:<pb:[^>]*>)+")
PARA_HEAD = re.compile(r"^(\d+)\.(\d+)\.(.*)$")
TOC_ENTRY = re.compile(r"\[\[file:KR1d0001_(\d{3})\.txt\]\[(\d+)\.(\d+) 〈([^〉]+)〉\]\]")
HAN = r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0003ffff]"
DUTY_HEAD = re.compile(r"^(%s{1,4}?)(之職|掌|為)" % HAN)
# 目次中的校勘记号（误字）〔正字〕，取正字
TOC_FIX = re.compile(r"（[^）]*）〔([^〕]*)〕")
NOTE_SPAN = re.compile(r"\([^()]*\)")
K2_HEAD = re.compile(r"^周禮卷|鄭氏[註注]$")

_report = []


def log(*parts):
    line = " ".join(str(p) for p in parts)
    _report.append(line)
    print(line)


def cjk_only(s):
    return "".join(CJK.findall(s))


def simp(s):
    return zhconv.convert(s, "zh-cn")


# --------------------------------------------------------------------------
# 一、底本 KR1d0001
# --------------------------------------------------------------------------
def parse_k1(path):
    """解析一卷正文，返回按 (篇序, 职官序) 归并的段落 OrderedDict。"""
    paras = OrderedDict()
    cur = None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n").rstrip("\r")
        # 页码标记 <pb:...> 后可能紧接正文（如「<pb:..>3.47.占夢」），只剥标记不丢正文
        line = PB.sub("", line)
        if not line or line.startswith("#"):
            continue
        if line.startswith("** "):
            continue
        m = PARA_HEAD.match(line)
        if m:
            key = (int(m.group(1)), int(m.group(2)))
            cur = key
            paras.setdefault(cur, [])
            paras[cur].append(m.group(3))
            continue
        if cur is None:
            continue
        paras[cur].append(line)
    out = OrderedDict()
    for key, buf in paras.items():
        text = "".join(part.replace("\u00b6", "") for part in buf).strip()
        out[key] = text
    return out


def load_toc():
    """解析 Readme.org 目次 → {篇序: [(职官序, 名), ...]}"""
    rm = open(os.path.join(K1, "Readme.org"), encoding="utf-8").read()
    toc = OrderedDict()
    for m in TOC_ENTRY.finditer(rm):
        toc.setdefault(int(m.group(2)), []).append((int(m.group(3)), m.group(4)))
    for k in toc:
        toc[k].sort()
    return toc


# --------------------------------------------------------------------------
# 二、校本
# --------------------------------------------------------------------------
def parse_k2(paths):
    """解析郑玄注本，去掉 () 注文即得经文。返回 (全文, 经文)。"""
    full, jing = [], []
    for p in paths:
        for raw in open(p, encoding="utf-8"):
            line = PB.sub("", raw.rstrip("\n").rstrip("\r"))
            if not line or line.startswith("#") or line.startswith("** "):
                continue
            line = line.replace("\u00b6", "")
            if K2_HEAD.search(line):          # 卷首标题行，非经文
                continue
            full.append(line)
            jing.append(NOTE_SPAN.sub("", line))
    return "".join(full), "".join(jing)


PLAIN_HEAD = re.compile(r"^(天官冢宰|地官司徒|春官宗伯|夏官司马|秋官司寇|冬官考工记)第[一二三四五六]$")


def load_plain(path):
    """殆知阁白文 → {简体篇名: 全文}"""
    lines = open(path, encoding="utf-8").read().split("\n")
    starts = [(i, ln.strip()) for i, ln in enumerate(lines)
              if i >= 10 and PLAIN_HEAD.match(ln.strip())]
    out = OrderedDict()
    for n, (idx, title) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        out[re.sub(r"第[一二三四五六]$", "", title)] = "".join(lines[idx + 1:end])
    return out


ZU_SHU_HEAD = re.compile(
    r"^[　\s]*◎(天官冢宰|地官司徒|春官宗伯|夏官司[馬马]|秋官司[寇㓂]|冬官考工[記记])第")
SKIP_LINE = re.compile(r"^[　\s]*(?:[○●◎\[［]|疏|釋曰|释曰)")


def load_zhushu(path):
    """殆知阁注疏 → 抽取经文部分 {篇名: 经文}"""
    lines = open(path, encoding="utf-8").read().split("\n")
    starts = [(i, m.group(1)) for i, ln in enumerate(lines)
              for m in [ZU_SHU_HEAD.match(ln)] if m]
    out = OrderedDict()
    for n, (idx, name) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        buf = []
        for raw in lines[idx:end]:
            if not raw.startswith("　　"):
                continue
            body = raw[2:]
            if SKIP_LINE.match(raw) or body.startswith("[疏]") or body.startswith("［疏］"):
                continue
            cut = body.find("（")
            buf.append(body if cut < 0 else body[:cut])
        out[name] = "".join(buf)
    return out


# --------------------------------------------------------------------------
# 三、校勘：k-mer 锚点 + 最长递增子序列
# --------------------------------------------------------------------------
def _anchors(a, b, k):
    import bisect
    pos_a = {}
    for i in range(len(a) - k + 1):
        pos_a.setdefault(a[i:i + k], []).append(i)
    cand = []
    seen = {}
    for j in range(len(b) - k + 1):
        g = b[j:j + k]
        if g in pos_a and len(pos_a[g]) == 1:
            seen.setdefault(g, []).append(j)
    for g, js in seen.items():
        if len(js) == 1:
            cand.append((pos_a[g][0], js[0]))
    cand.sort()
    if not cand:
        return []
    tails, tail_idx, prev = [], [], [-1] * len(cand)
    for i, (_, y) in enumerate(cand):
        p = bisect.bisect_left(tails, y)
        if p == len(tails):
            tails.append(y)
            tail_idx.append(i)
        else:
            tails[p] = y
            tail_idx[p] = i
        prev[i] = tail_idx[p - 1] if p else -1
    chain, cur = [], tail_idx[-1]
    while cur != -1:
        chain.append(cand[cur])
        cur = prev[cur]
    chain.reverse()
    return chain


def collate(base, witness, k=8, max_events=300):
    a, b = cjk_only(base), cjk_only(witness)
    anchors = _anchors(a, b, k)
    bounds = [(-1, -1)] + anchors + [(len(a), len(b))]
    events = []
    for n in range(len(bounds) - 1):
        a0, b0 = bounds[n]
        a1, b1 = bounds[n + 1]
        s0 = a0 + k if a0 >= 0 else 0
        seg_a = a[s0:a1]
        seg_b = b[(b0 + k if b0 >= 0 else 0):b1]
        if seg_a == seg_b:
            continue
        kind = "异文" if (seg_a and seg_b) else ("底本多出" if seg_a else "底本阙")
        events.append({
            "kind": kind, "pos": s0,
            "底本": seg_a, "异本": seg_b,
            "上接": a[max(0, s0 - 12):s0], "下接": a[a1:a1 + 12],
        })
        if len(events) >= max_events:
            break
    return events, len(anchors)


def merge_shift(events):
    """相邻的「底本阙 + 底本多出」且内容相同者，实为段落错位，合为一条。"""
    out, i = [], 0
    while i < len(events):
        e = events[i]
        if (e["kind"] == "底本阙" and i + 1 < len(events)
                and events[i + 1]["kind"] == "底本多出"
                and e["异本"] and e["异本"] == events[i + 1]["底本"]):
            out.append({"kind": "段序错位", "pos": e["pos"],
                        "底本": e["底本"], "异本": e["异本"],
                        "上接": e["上接"], "下接": events[i + 1]["下接"]})
            i += 2
            continue
        out.append(e)
        i += 1
    return out


# --------------------------------------------------------------------------
# 四、职官解析
# --------------------------------------------------------------------------
def split_name(head, toc_name):
    """由职掌段首句定职官名；正文名残缺或带虚字时回退目次名。

    返回 (采用名, 目次名, 说明)。
    """
    m = DUTY_HEAD.match(head)
    got = m.group(1) if m else ""
    if toc_name and got == toc_name:
        return got, toc_name, "一致"
    if toc_name and got and got.startswith(toc_name) and len(got) > len(toc_name):
        return toc_name, toc_name, "取目次（正文带虚字）"
    if toc_name and got and toc_name.endswith(got) and len(toc_name) > len(got):
        return toc_name, toc_name, "取目次（正文缺字）"
    if got:
        return got, toc_name, "取正文（目次异）"
    return (toc_name or ""), toc_name, "取目次（正文首句无可辨名）"


def extract_staff(xuguan, names):
    """从叙官文字按目次顺序切出各职官员额。"""
    out = OrderedDict()
    cursor = 0
    positions = []
    for name in names:
        i = xuguan.find(name, cursor)
        if i < 0:
            i = xuguan.find(name)
        if i < 0:
            positions.append(None)
            continue
        positions.append((i, i + len(name)))
        cursor = i + len(name)
    real = [(n, p) for n, p in zip(names, positions) if p]
    for idx, (name, (s, e)) in enumerate(real):
        stop = real[idx + 1][1][0] if idx + 1 < len(real) else len(xuguan)
        out[name] = xuguan[e:stop].strip("，,；;。：:　 ")
    return out


# --------------------------------------------------------------------------
# 五、主流程
# --------------------------------------------------------------------------
def main():
    for d in (TEXT, STRUCT):
        os.makedirs(d, exist_ok=True)

    toc = load_toc()
    chapters = []

    for order in range(1, 7):
        path = os.path.join(K1, "KR1d0001_%03d.txt" % order)
        if not os.path.exists(path):
            raise SystemExit("缺少底本文件：%s（请先运行 scripts\\fetch_kanripo.py）" % path)
        paras = parse_k1(path)
        xuguan = paras.get((order, 0), "")
        # 目次名中的校勘记号 （误）〔正〕 取正字
        toc_entries = [(m, TOC_FIX.sub(r"\1", n)) for m, n in toc.get(order, [])]
        names = [n for m, n in toc_entries if m >= 1]

        staff = extract_staff(xuguan, names)

        officers = []
        for m, toc_name in toc_entries:
            if m == 0:
                continue
            body = paras.get((order, m), "")
            head = body.split("，")[0] if body else ""
            name, _toc, how = split_name(head, toc_name)
            officers.append({
                "序号": m,
                "职官": name,
                "目次名": toc_name,
                "取名方式": how,
                "员额": staff.get(name, staff.get(toc_name, "")),
                "职掌": body[:120],
                "_全段": body,
            })

        # 正文有而目次无的编号
        extra = sorted(set(k[1] for k in paras if k[0] == order) -
                       {m for m, _ in toc_entries} - {0})
        missing = sorted({m for m, _ in toc_entries if m >= 1} -
                         {k[1] for k in paras if k[0] == order})

        segs = [{"段序": i + 1, "职官序": k[1], "繁体": v}
                for i, (k, v) in enumerate(sorted(paras.items()))]
        full = "".join(s["繁体"] for s in segs)

        chapters.append({
            "序号": order, "篇名": CHAPTER_NAMES[order - 1],
            "叙官": xuguan, "职官": officers, "段落": segs,
            "繁体": full, "简体": simp(full),
            "目次条数": len(toc_entries), "正文段数": len(segs),
            "目次有正文无": missing, "正文有目次无": extra,
        })
        log("[底本] %-5s 段=%-3d 职官=%-3d 汉字=%d  目次有正文无=%s 正文有目次无=%s"
            % (chapters[-1]["篇名"], len(segs), len(officers),
               len(cjk_only(full)), missing or "无", extra or "无"))

    total = sum(len(cjk_only(c["繁体"])) for c in chapters)
    log("底本合计汉字：%d" % total)

    # ---- 纯文本输出 ----
    with open(os.path.join(TEXT, "周礼.繁体.txt"), "w", encoding="utf-8") as w:
        for c in chapters:
            w.write("\n\n%s第%d\n\n" % (c["篇名"], c["序号"]))
            for s in c["段落"]:
                w.write("%s\n" % s["繁体"])
    with open(os.path.join(TEXT, "周礼.简体.txt"), "w", encoding="utf-8") as w:
        for c in chapters:
            w.write("\n\n%s第%d\n\n" % (simp(c["篇名"]), c["序号"]))
            for s in c["段落"]:
                w.write("%s\n" % simp(s["繁体"]))
    with open(os.path.join(TEXT, "周礼.职官.繁体.txt"), "w", encoding="utf-8") as w:
        for c in chapters:
            w.write("\n\n=== %s第%d（%d 职官）===\n" % (c["篇名"], c["序号"], len(c["职官"])))
            for o in c["职官"]:
                w.write("\n[%d.%d %s]%s\n  员额：%s\n  职掌：%s\n"
                        % (c["序号"], o["序号"], o["职官"],
                           ("  ※取名：" + o["取名方式"]) if o["取名方式"] != "一致" else "",
                           o["员额"] or "（未见于叙官）", o["_全段"]))

    # ---- 校本 ----
    log("")
    witnesses = OrderedDict()

    k2_full_all, k2_jing_all = [], []
    for order, (a, b) in enumerate(K2_FILE_PAIRS, start=1):
        paths = [os.path.join(K2, "KR1d0002_%03d.txt" % n) for n in (a, b)]
        if not all(os.path.exists(p) for p in paths):
            log("[校本] 郑玄注本第%d篇文件缺失，跳过" % order)
            witnesses.setdefault("郑玄注本", {})[CHAPTER_NAMES[order - 1]] = None
            continue
        full, jing = parse_k2(paths)
        k2_full_all.append(full)
        k2_jing_all.append(jing)
        witnesses.setdefault("郑玄注本", {})[CHAPTER_NAMES[order - 1]] = jing
        log("[校本] 郑玄注本 %-5s 经文汉字=%d" % (CHAPTER_NAMES[order - 1], len(cjk_only(jing))))

    with open(os.path.join(TEXT, "周礼.郑玄注本.繁体.txt"), "w", encoding="utf-8") as w:
        for order in range(6):
            w.write("\n\n%s第%d（郑玄注）\n\n%s\n"
                    % (CHAPTER_NAMES[order], order + 1,
                       k2_full_all[order] if order < len(k2_full_all) else ""))
    with open(os.path.join(TEXT, "周礼.郑玄注本.经文.繁体.txt"), "w", encoding="utf-8") as w:
        for order in range(6):
            w.write("\n\n%s第%d\n\n%s\n"
                    % (CHAPTER_NAMES[order], order + 1,
                       k2_jing_all[order] if order < len(k2_jing_all) else ""))

    # ── 殆知阁校本（可选）────────────────────────────────────────────────────
    # 上游仓库未声明许可证，因此本仓库不分发它们，也不分发由它们派生的校勘
    # 结果（见 NOTICE）。--kanripo-only 或原始文件不存在时，校勘只跑 Kanripo
    # 的两个校本。
    plain_s, zw_s = OrderedDict(), OrderedDict()
    if KANRIPO_ONLY:
        log("[校本] 白文／注疏：--kanripo-only，跳过（殆知阁来源未声明授权）")
    elif not (os.path.exists(PLAIN_RAW) and os.path.exists(ZHUSHU_RAW)):
        log("[校本] 白文／注疏：原始文件不存在，跳过"
            "（如需本地互校，先跑 fetch_corpus.py --with-daizhige）")
    else:
        plain = load_plain(PLAIN_RAW)
        plain_s = OrderedDict((simp(k), v) for k, v in plain.items())
        log("[校本] 白文     %s"
            % "、".join("%s %d" % (k, len(cjk_only(v))) for k, v in plain_s.items()))

        zw = load_zhushu(ZHUSHU_RAW)
        zw_s = OrderedDict((simp(k), v) for k, v in zw.items())
        log("[校本] 注疏经文 %s"
            % "、".join("%s %d" % (k, len(cjk_only(v))) for k, v in zw_s.items()))
        with open(os.path.join(TEXT, "周礼.注疏经文.简体.txt"), "w", encoding="utf-8") as w:
            for k, v in zw_s.items():
                w.write("\n\n%s\n\n%s\n" % (k, v))

    # ---- 校勘 ----
    log("\n[校勘]（以底本为准，异本逐条列出）")
    jiaokan = OrderedDict()
    for c in chapters:
        name_s = simp(c["篇名"])
        base = c["简体"]
        entry = OrderedDict()
        cand = [
            ("郑玄注本", witnesses.get("郑玄注本", {}).get(c["篇名"])),
            ("白文", plain_s.get(name_s)),
            ("注疏", zw_s.get(name_s)),
        ]
        for tag, src in cand:
            if not src:
                log("       %-5s vs %-6s 缺源，跳过" % (c["篇名"], tag))
                continue
            events, nanc = collate(base, simp(src))
            events = merge_shift(events)
            entry[tag] = {"锚点数": nanc, "事件数": len(events), "事件": events}
            log("       %-5s vs %-6s 锚点=%-5d 异文=%d" % (c["篇名"], tag, nanc, len(events)))
        jiaokan[c["篇名"]] = entry

    # 校勘记纯文本
    with open(os.path.join(TEXT, "周礼.校勘记.txt"), "w", encoding="utf-8") as w:
        w.write("《周礼》校勘记\n")
        w.write("底本：Kanripo KR1d0001《周禮》正文（CC BY-SA 4.0）\n")
        w.write("校本：郑玄注本（Kanripo KR1d0002，四部叢刊本）、"
                "白文（殆知阁）、注疏（殆知阁）\n")
        w.write("比对方式：繁简归一、去标点后取汉字串，以 8 字唯一锚点定位；"
                "「底本」为 KR1d0001 文字，「异本」为对照本文字。\n")
        w.write("注意：字形异体（如 䏈/聮/联、𨵽/阍）与段落切分差异亦会列出，"
                "并非全为实质异文。\n")
        w.write("=" * 72 + "\n")
        for name, entry in jiaokan.items():
            for tag, blk in entry.items():
                w.write("\n\n### %s  vs  %s    锚点 %d    事件 %d\n"
                        % (name, tag, blk["锚点数"], blk["事件数"]))
                for e in blk["事件"]:
                    w.write("  [%s] …%s⟨%s⟩→⟨%s⟩%s…\n"
                            % (e["kind"], e["上接"], e["底本"], e["异本"], e["下接"]))

    # ---- 主数据 ----
    payload = {
        "书名": "周礼",
        "又名": ["周官"],
        "简介": "《周礼》原名《周官》，记周代官制，分天、地、春、夏、秋、冬六官，"
                "冬官一篇亡佚，汉人以《考工记》补之。全书六篇，为十三经之一。",
        "底本": {
            "来源": "Kanripo 漢籍リポジトリ（京都大学人文科学研究所）",
            "编号": "KR1d0001《周禮》正文",
            "地址": "https://github.com/kanripo/KR1d0001",
            "版本标记": "BASEEDITION tls",
            "授权": "CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）",
        },
        # 只有真正参与本次校勘的校本才写进元数据；殆知阁两本默认不在其中。
        "校本": [
            {"名称": "郑玄注本", "来源": "Kanripo KR1d0002《周禮》鄭玄注",
             "版本标记": "BASEEDITION SBCK（四部叢刊）",
             "地址": "https://github.com/kanripo/KR1d0002",
             "授权": "CC BY-SA 4.0", "用法": "剔除 () 注文后取经文"},
        ] + ([{
            "名称": "白文", "来源": "殆知阁古代文献 儒藏/礼经/周礼.txt",
            "地址": "https://github.com/garychowcmu/daizhigev20",
            "授权": "上游仓库未声明许可证；仅本地互校使用，本仓库不分发",
        }] if plain_s else []) + ([{
            "名称": "注疏", "来源": "殆知阁古代文献 儒藏/礼经/周礼注疏.txt",
            "地址": "https://github.com/garychowcmu/daizhigev20",
            "授权": "同上；郑玄注、贾公彦疏；仅本地互校使用，本仓库不分发",
        }] if zw_s else []),
        "统计": {
            "底本汉字数": total,
            "篇数": len(chapters),
            "段数": sum(len(c["段落"]) for c in chapters),
            "职官数": sum(len(c["职官"]) for c in chapters),
        },
        "篇": [
            {
                "序号": c["序号"], "篇名": c["篇名"],
                "简体篇名": simp(c["篇名"]),
                "汉字数": len(cjk_only(c["繁体"])),
                "段数": len(c["段落"]),
                "职官数": len(c["职官"]),
                "叙官": c["叙官"],
                "职官": [
                    {"序号": o["序号"], "职官": o["职官"], "目次名": o["目次名"],
                     "取名方式": o["取名方式"], "员额": o["员额"], "职掌": o["_全段"]}
                    for o in c["职官"]
                ],
                "段落": [
                    {"段序": s["段序"], "职官序": s["职官序"],
                     "繁体": s["繁体"], "简体": simp(s["繁体"])}
                    for s in c["段落"]
                ],
            }
            for c in chapters
        ],
    }
    with open(os.path.join(STRUCT, "zhouli.json"), "w", encoding="utf-8") as w:
        json.dump(payload, w, ensure_ascii=False, indent=2)

    # ---- 职官索引 ----
    zhiguan = OrderedDict()
    for c in chapters:
        for o in c["职官"]:
            rec = zhiguan.setdefault(o["职官"], {
                "职官": o["职官"], "简体": simp(o["职官"]), "篇": [], "条目": []})
            if c["篇名"] not in rec["篇"]:
                rec["篇"].append(c["篇名"])
            rec["条目"].append({
                "篇": c["篇名"], "篇序": c["序号"], "职官序": o["序号"],
                "员额": o["员额"], "职掌": o["_全段"][:160],
                "取名方式": o["取名方式"]})
    with open(os.path.join(STRUCT, "zhiguan.json"), "w", encoding="utf-8") as w:
        json.dump({"职官数": len(zhiguan), "职官": list(zhiguan.values())},
                  w, ensure_ascii=False, indent=2)
    log("\n[职官] 去重后职官名 %d 个" % len(zhiguan))

    with open(os.path.join(STRUCT, "jiaokan.json"), "w", encoding="utf-8") as w:
        json.dump(jiaokan, w, ensure_ascii=False, indent=2)

    stats = {
        "底本": payload["底本"], "校本": payload["校本"],
        "底本汉字数": total,
        "篇数": len(chapters),
        "段数": sum(len(c["段落"]) for c in chapters),
        "职官数": sum(len(c["职官"]) for c in chapters),
        "职官去重数": len(zhiguan),
        "每篇": {c["篇名"]: {"字数": len(cjk_only(c["繁体"])),
                            "段数": len(c["段落"]),
                            "职官数": len(c["职官"])} for c in chapters},
        "目次与正文差异": {c["篇名"]: {"目次条数": c["目次条数"],
                                      "正文段数": c["正文段数"],
                                      "目次有正文无": c["目次有正文无"],
                                      "正文有目次无": c["正文有目次无"]}
                           for c in chapters},
        "校勘事件数": {k: {t: v["事件数"] for t, v in e.items()} for k, e in jiaokan.items()},
    }
    with open(os.path.join(STRUCT, "stats.json"), "w", encoding="utf-8") as w:
        json.dump(stats, w, ensure_ascii=False, indent=2)

    with open(os.path.join(STRUCT, "_build_report.txt"), "w", encoding="utf-8") as w:
        w.write("\n".join(_report))
    log("\n构建完成 → %s" % STRUCT)
    return 0


if __name__ == "__main__":
    import argparse
    _ap = argparse.ArgumentParser(description="构建《周礼》结构化语料库")
    _ap.add_argument("--kanripo-only", action="store_true",
                     help="只用 Kanripo（CC BY-SA 4.0）的两个校本，排除未声明授权的殆知阁来源")
    _args = _ap.parse_args()
    KANRIPO_ONLY = _args.kanripo_only
    sys.exit(main())
