# -*- coding: utf-8 -*-
"""比较 dsh-tools 各版本的类型声明，判断能否安全扩大 peer 范围。

扩 peer 范围是在声明兼容性，所以要看被我用到的那些导出有没有变：
defineTool、ToolDefinition、ToolRegistry 之类。
"""
import difflib
import json
import os
import subprocess
import tarfile
import tempfile
import urllib.request


def npm(*a):
    r = subprocess.run(["npm.cmd"] + list(a), capture_output=True, text=True, encoding="utf-8")
    return (r.stdout + r.stderr).strip()


def fetch_dts(ver, member_filter="index.d.ts"):
    meta = json.loads(npm("view", "@deepseek-ai/dsh-tools@%s" % ver, "--json"))
    tmp = os.path.join(tempfile.gettempdir(), "dt-%s.tgz" % ver)
    if not os.path.exists(tmp):
        urllib.request.urlretrieve(meta["dist"]["tarball"], tmp)
    with tarfile.open(tmp) as tf:
        names = [n for n in tf.getnames() if n.endswith(member_filter)]
        if not names:
            return None
        return tf.extractfile(names[0]).read().decode("utf-8", "replace")


versions = ["0.1.2-rc.1", "0.1.5-rc.2", "0.1.7-rc.2", "0.2.0-rc.2"]
texts = {}
for v in versions:
    try:
        texts[v] = fetch_dts(v)
        print("取到 %-12s index.d.ts %6d 字符" % (v, len(texts[v])))
    except Exception as e:
        print("取不到 %-12s %s" % (v, e))

print()
print("=== 与当前 harness 所用版本 0.1.7-rc.2 的差异 ===")
base = texts.get("0.1.7-rc.2")
for v in ["0.1.2-rc.1", "0.1.5-rc.2", "0.2.0-rc.2"]:
    if v not in texts or base is None:
        continue
    a = texts[v].split("\n")
    b = base.split("\n")
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    changed = sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal")
    print("  %-12s 与 0.1.7-rc.2 差异行数: %d / %d" % (v, changed, max(len(a), len(b))))
    if changed:
        n = 0
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                continue
            print("    [%s] %s" % (tag, " | ".join((a[i1:i2] or b[j1:j2])[:3])[:160]))
            n += 1
            if n >= 4:
                print("    …")
                break

print()
print("=== 本插件用到的符号是否在各版本都在 ===")
need = ["defineTool", "interface ToolDefinition", "ToolRegistry", "parameters", "execute"]
print("  %-12s %s" % ("版本", "  ".join("%-22s" % s for s in need)))
for v in versions:
    if v not in texts:
        continue
    row = "  ".join("%-22s" % ("有" if s in texts[v] else "缺") for s in need)
    print("  %-12s %s" % (v, row))
