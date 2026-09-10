# dsh-zhouli · 周礼

![編鐘列於左，編磬列於右，王居其中](https://raw.githubusercontent.com/SCP-CN-1059/dsh-zhouli/main/assets/hero.jpg)

*圖：編鐘在左，編磬在右，王居其中。《周礼·春官宗伯》3.30 磬師「掌教擊磬，擊編鍾」，3.31 鍾師「掌金奏」。此為示意圖，非文物影像。*

《周礼》六篇，凡四万九千三百八十四字。此篇使之可为 agent 所检索、所引证。

设官二，分职各有所掌：

一曰 **`zhouli`** —— 掌《周礼》全文之检索、职官之考据、两本之比勘；
二曰 **「周礼模式」** —— 凡会话之始终，皆依六官法度而行。

凡 `zhouli` 所出，条条系以坐标 `篇序.职官序`，如 `1.1` 即〈大宰〉，引证作《周礼·天官冢宰》1.1。
所以然者：**所引须可覆按于原文，不得凭记忆而诵经。** 此非饰辞，是设此官之本意。

DSH / Cordis 之 `dsh-plugin`。

---

## 置官（安装）

```powershell
# 自 npm 取之
dsh plugin --profile web add dsh-zhouli
```

或径自 GitHub 取之：

```powershell
dsh plugin --profile web add github:SCP-CN-1059/dsh-zhouli
```

`dsh plugin` 转发于 **pnpm**，故本机须有 pnpm 在 PATH。装毕重启该 profile，`zhouli` 即入工具之列。

本包于 `package.json` 中自陈 `dsh.bundle.patch`，故 `dsh plugin add` 之后自动入该 profile 之
layer stack，**无须手改 composition**。

不愿为一 profile 置之，亦可于自设预设中自立一行：

```yaml
- id: tool-zhouli
  name: dsh-zhouli
  config:
    dataDir: ''     # 可省，默认用包内自带 data/
    maxResults: 20  # 可省，单次返回之上限
```

## 职掌（用法）

工具一入口，以 `action` 辨事：

```
zhouli(action, query?, coordinate?, chapter?, limit?)
```

| 事 | 所掌 | 所须 |
|---|---|---|
| `search` | 掌全文检索，繁体优先，简体兜底 | `query` 必与；`chapter`、`limit` 可省 |
| `para` | 掌按坐标取一段原文，繁体简体并列 | `coordinate` 必与，形如 `1.1` |
| `zhiguan` | 掌考某官职之员额与职掌 | `query` 为职官名；省之则列其全 |
| `list` | 掌列某篇（或全部）之职官名 | `chapter`、`limit` 可省 |
| `chapter` | 掌列某篇之段落原文 | `chapter` 必与；`limit` 可省 |
| `stats` | 掌报语料之数与底本所出 | 无 |

`chapter` 受繁体篇名、简体篇名、或序号 1–6，三者同功。

凡三事，可为常式：

```
zhouli(action:"para", coordinate:"1.1")
  → 《周礼·天官冢宰》1.1  §2
    繁体：大宰之職，掌建邦之六典，以佐王治邦國：……
    简体：大宰之职，掌建邦之六典，以佐王治邦国：……

zhouli(action:"zhiguan", query:"大宰")
  → 职官：大宰（简体 大宰）    所属：天官冢宰
       【天官冢宰 1.1】
         员额：卿一人
         职掌：大宰之職，掌建邦之六典……

zhouli(action:"search", query:"六計", chapter:"天官冢宰")
  → 命中 1 处（限 天官冢宰）……
```

## 坐标

凡段皆有坐标 `篇序.职官序`。

篇序 1–6，依次为天官冢宰、地官司徒、春官宗伯、夏官司馬、秋官司寇、冬官考工記。

职官序 `.0` 为该篇**叙官**，列全官之员额编制；`.1` 及以下，各官之职掌条文。

例：`1.0` 天官叙官，`1.1`〈大宰〉，`1.2`〈小宰〉，`3.21`〈大司樂〉，`6.1`〈輪人〉。

引证之式：**《周礼·天官冢宰》1.1**。

## 六官（语料库）

| | |
|---|---|
| 篇 | 6 |
| 汉字 | 49,384（不计标点） |
| 段 | 383 |
| 职官 | 377（去重 374） |
| 互校 | Kanripo 两本之间 567 条异文 |

`data/` 下四篇 JSON —— `zhouli.json` 主数据、`zhiguan.json` 职官索引、`jiaokan.json` 校勘记、
`stats.json` 统计 —— 为插件所读；`data/text/` 下为同一语料之人可读文本。

## 法度（授权）

**二分，各有所属。**

- **代码**（插件、预设、脚本）—— MIT，见 `LICENSE`。
- **语料**（`data/`）—— 底本出自 [Kanripo 漢籍リポジトリ](https://www.kanripo.org/)
  （京都大学人文科学研究所）`KR1d0001`《周禮》正文与 `KR1d0002`《周禮》鄭玄注，
  为 **CC BY-SA 4.0**。转发或改写者，须存其署名，并以相同方式共享。
  《周礼》本文属公有领域；此许可所覆者，是其现代数字化之成果。

本仓库**不收**殆知阁古代文献之二本（其上游仓库未声明任何许可证），亦不收由其派生之校勘结果。
`scripts/fetch_corpus.py --with-daizhige` 可为本地自用取之；取与不取、随之而来的授权问题，
由取者自决。

其详在 `NOTICE`。

## 考工（开发）

以下诸事，皆于**本仓库检出目录**中行之，不在已装之包内。
（npm 以 `files` 定发布之内容：`lib/ data/ preset/ scripts/ 检索.ps1` 随包而去，`test/` 唯在仓库。）

```powershell
# 取原始素材（Kanripo，凡 21 件）
python scripts\fetch_corpus.py

# 构建 data/ 之语料（--kanripo-only 只用 CC BY-SA 之 Kanripo 两本）
python scripts\build_corpus.py --kanripo-only

# 冒烟测试：三十五事，含回查引文库与 persona 所引是否真在语料之中
npm test
```

`npm test` 须 `@deepseek-ai/{cordis,dsh-tools,schemastery}` 可解析（本地软链或 `npm install` 皆可）。
测试会取 `preset/skills/zhouli/SKILL.md` 之引文库与 `preset/agent.cordis.yml` 之 persona 引文，
逐条回查语料 —— 故引文库与语料，不得各自漂移。

### 打包与依赖上的两处讲究

**一、`files` 不可写整目录。** `.gitignore` 只约束 git，**对 npm 毫无作用**；写 `"data"`
会把 `data/raw/` 里未获授权的上游文本一并打进 tarball。故 `files` 收紧到
`data/*.json` 与 `data/text`，并以 `scripts/check-pack.mjs` 逐条核对 dry-run 清单，
挂在 `prepublishOnly` 上 —— 不通过则发不出去。

**二、`@deepseek-ai/dsh-tools` 的 peer 范围须以 `||` 枚举各版本元组。**
semver 只在范围中存在「`major.minor.patch` 元组相同、且自身带预发布标签」的比较符时
才放行预发布版本。拿 20 个已发布版本实测：

| 写法 | 未覆盖 |
|---|---|
| `^0.1.2-rc.1` | 19/20 |
| `>=0.0.1-rc.1 <0.1.0 \|\| >=0.1.0-rc.1 <0.2.0-0`（某规范所举范例） | 11/20 |
| `>=0.0.1-rc.1 <0.2.0` | 16/20 |
| **本包采用：逐元组枚举** | **4/20**（仅四个远古 `0.0.1-rc.*`） |

代价是未来新出现的预发布元组仍需追加分支 —— 这是 semver 规则的固有局限，无解。

命令行检索（与插件共用同一份 `data/`）：

```powershell
.\检索.ps1 检索 六典
.\检索.ps1 职官 大宰
.\检索.ps1 段落 1.1
.\检索.ps1 叙官 天官冢宰
.\检索.ps1 校勘 -篇 天官冢宰
```

> **`检索.ps1` 须以「带 BOM 之 UTF-8」存之。** Windows PowerShell 5.1 于无 BOM 时，按系统
> ANSI 代码页解 `.ps1`，其中文命令名立成乱码，脚本不可解析。若改毕而报语法错，先验其 BOM：
> ```powershell
> $p = '.\检索.ps1'
> $t = Get-Content $p -Raw -Encoding UTF8
> [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($true)))
> ```

---

## 周礼模式（预设）

`preset/` 为一完整 agent 预设（自 `standard` 复制而来），使此包自「能查」进于「必查」。

**常驻 persona**（order 0，遮蔽部署人设）立三段之法：

一曰 **开篇·设官分职** —— 《周礼·天官冢宰》云「惟王建國，辨方正位，體國經野，設官分職，以為民極」。
接手任何任务，先以一两行辨方正位、设官分职，而后动手。

二曰 **事中·依典援据** —— 先定六典之属；凡遇判断关口，依八法自查
（官屬·官職·官聯·官常·官成·官法·官刑·官計）；做工依《考工記》「審曲面埶，以飭五材，以辨民器」。

三曰 **收尾·岁终之会** —— 每条会话以「会」收束：所职、所据、**六计自陈**
（廉善·廉能·廉敬·廉正·廉法·廉辨）、未竟、周礼背书（注明坐标）。

其硬约束：**六计有做不到者照实写明；未验证者不得称为已验；引文必须真实存在。**

**自带 `zhouli` 技能** —— 载坐标系统、工具用法、引证格式，及一份已逐条核实之引文库。

置之（预设与包分置）：

```powershell
Copy-Item -Recurse .\preset "$env:USERPROFILE\.dsh\.agent-presets\zhouli"
```

而后新建会话时择「周礼模式」。
