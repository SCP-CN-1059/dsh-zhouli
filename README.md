# dsh-zhouli · 周礼

给 DeepSeek Harness 用的《周礼》插件：把《周礼》六篇全文做成一个模型可调用的 `zhouli` 工具，
再配一个让整个会话都依六官法度行事的 agent 预设。

工具返回的每一条都带**稳定坐标** `篇序.职官序`（如 `1.1` 即〈大宰〉），
所以 agent 引用的每一句都能回到原文核对。这不是修辞装饰——它要解决的是
**agent 不再凭记忆背诵经文**。

DeepSeek Harness / Cordis 的 `dsh-plugin`。

---

## 安装

```powershell
# 从 GitHub 安装（尚未发布到 npm）
dsh plugin --profile web add github:SCP-CN-1059/dsh-zhouli
```

装好后重启该 profile，`zhouli` 工具即出现在工具列表中。`dsh plugin` 转发给 **pnpm**，
所以本机需要 pnpm 在 PATH 上。

> 本包在 `package.json` 中声明了 `dsh.bundle.patch`，因此 `dsh plugin add` 之后会被自动
> 加入该 profile 的 layer stack —— 不需要手工改 composition 文件。

不给整个 profile 装也可以：在自己的 agent preset 里挂一行同名的行即可，

```yaml
- id: tool-zhouli
  name: dsh-zhouli
  config:
    dataDir: ''     # 可选：默认用包内自带的 data/
    maxResults: 20  # 可选：单次返回上限
```

## 用法

工具只有一个入口，靠 `action` 区分：

```
zhouli(action, query?, coordinate?, chapter?, limit?)
```

| action | 用途 | 参数 |
|---|---|---|
| `search` | 全文检索（繁体优先，简体兜底） | `query` 必填；`chapter`、`limit` 可选 |
| `para` | 按坐标取一段原文（繁体＋简体对照） | `coordinate` 必填，形如 `1.1` |
| `zhiguan` | 查某官职的员额编制与职掌 | `query` 为职官名；省略则列出全部 |
| `list` | 列出某篇（或全部）的职官名 | `chapter`、`limit` 可选 |
| `chapter` | 列出某篇的段落原文 | `chapter` 必填；`limit` 可选 |
| `stats` | 语料库规模与底本来源 | — |

`chapter` 接受繁体篇名、简体篇名或序号 1–6，三者等价。

典型往返：

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

## Agent 预设：周礼模式

`preset/` 是一个完整的 agent preset（由 `standard` 复制而来），把这个包从"能查"变成"必须查"：

- **常驻 persona**（order 0，遮蔽部署人设）规定三段法度：
  - **开篇·设官分职** —— 接手任务先「辨方正位」（真正要做什么、边界、成功判据）与
    「设官分职」（拆成工作单元，各明职掌与交付）；
  - **事中·依典援据** —— 定六典归属，遇判断关口依「八法」自查（官屬·官職·官聯·官常·
    官成·官法·官刑·官計），做工依《考工記》「審曲面埶，以飭五材，以辨民器」；
  - **收尾·岁终之会** —— 每条会话以「会」收束：所职／所据／**六计自陈**（廉善·廉能·
    廉敬·廉正·廉法·廉辨）／未竟／周礼背书（注明坐标）。
  - 硬约束：**六计有做不到的照实写明，未验证的不得称为已验，引文必须真实存在。**
- **自带 `zhouli` skill** —— 坐标系统、工具用法、引证格式，以及一份**已逐条核实**的引文库。

安装（preset 与包分开）：

```powershell
Copy-Item -Recurse .\preset "$env:USERPROFILE\.dsh\.agent-presets\zhouli"
```

然后在新建会话时选择「周礼模式」。

## 语料库

| | |
|---|---|
| 篇数 | 6（天官冢宰 / 地官司徒 / 春官宗伯 / 夏官司馬 / 秋官司寇 / 冬官考工記） |
| 汉字 | 49,384（不含标点） |
| 段落 | 383 |
| 职官 | 377（去重 374） |
| 互校 | Kanripo 两本之间 567 条异文事件 |

`data/` 下四个 JSON（`zhouli.json` 主数据、`zhiguan.json` 职官索引、`jiaokan.json`
校勘记、`stats.json` 统计）供插件读取，`data/text/` 下是同一份语料的人可读纯文本。

### 坐标系统

每段有稳定坐标 `篇序.职官序`：`.0` 是该篇「叙官」（全部官职的员额编制），`.1` 及以下
是各官职的职掌条文。引证写作 **《周礼·天官冢宰》1.1**。

## 授权

**两部分，两种许可。**

- **代码**（插件、预设、脚本）—— MIT，见 `LICENSE`。
- **语料**（`data/`）—— 底本取自 [Kanripo 漢籍リポジトリ](https://www.kanripo.org/)
  （京都大学人文科学研究所）`KR1d0001`《周禮》正文与 `KR1d0002`《周禮》鄭玄注，
  采用 **CC BY-SA 4.0**。转发或改写这份数据时须保留署名，并以相同方式共享。
  《周礼》原文本身属公有领域；上述许可覆盖的是它所依据的现代数字化成果。

本仓库**不包含**殆知阁古代文献的两份校本（其上游仓库未声明任何许可证），也不包含
由它们派生的校勘结果。`scripts/fetch_corpus.py --with-daizhige` 可为本地自用取回它们，
是否这样做以及随之而来的授权问题由你自己判断。

全部细节见 `NOTICE`。

## 开发

以下命令都在**本仓库的检出目录**里运行，不在已安装的包里。
（npm 的 `files` 字段决定了发布内容：`lib/ data/ preset/ scripts/ 检索.ps1` 会随包分发，
`test/` 只在仓库里。）

```powershell
# 取原始素材（约 21 个文件，来自 Kanripo 的 GitHub 仓库）
python scripts\fetch_corpus.py

# 构建 data/ 下的语料（--kanripo-only 只使用 CC BY-SA 的 Kanripo 两本）
python scripts\build_corpus.py --kanripo-only

# 冒烟测试：35 项，含回查引文库与 persona 引文是否真的存在于语料中
npm test
```

`npm test` 需要 `@deepseek-ai/{cordis,dsh-tools,schemastery}` 可解析（本地软链或
`npm install` 皆可）。测试会解析 `preset/skills/zhouli/SKILL.md` 的引文库与
`preset/agent.cordis.yml` 的 persona 引文，逐条回查语料 —— 引文库与语料因此不会各自漂移。

命令行检索（与插件共用同一份 `data/`）：

```powershell
.\检索.ps1 检索 六典
.\检索.ps1 职官 大宰
.\检索.ps1 段落 1.1
.\检索.ps1 叙官 天官冢宰
.\检索.ps1 校勘 -篇 天官冢宰
```

> **`检索.ps1` 必须以「带 BOM 的 UTF-8」保存。** Windows PowerShell 5.1 在没有 BOM 时
> 按系统 ANSI 代码页解码 `.ps1`，脚本里的中文命令名会立刻变成乱码并导致解析失败。
> 若改动后发现脚本报语法错，先检查 BOM：
> ```powershell
> $p = '.\检索.ps1'
> $t = Get-Content $p -Raw -Encoding UTF8
> [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding($true)))
> ```

## 授权

代码 MIT，语料 CC BY-SA 4.0。详见 `LICENSE` 与 `NOTICE`。
