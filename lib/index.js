/**
 * dsh-zhouli — a 《周礼》 (Rites of Zhou) lookup tool for the DeepSeek Harness.
 *
 * Registers one model-facing tool, `zhouli`, over a structured corpus of the
 * six chapters of the 《周礼》: full text in traditional and simplified Chinese,
 * a per-office index (员额 establishment and 职掌 duty), and collation notes
 * between two independent Kanripo witnesses.
 *
 * The tool exists so an agent can cite the classic from a checkable source
 * instead of reciting it from memory. Every row it returns carries a stable
 * coordinate — `篇序.职官序`, e.g. `1.1` for 〈大宰〉 — so a citation can be
 * traced back to the text.
 *
 * Data ships with the package under `data/`; `config.dataDir` overrides it.
 * The corpus is derived from the Kanripo 漢籍リポジトリ (CC BY-SA 4.0) —
 * see NOTICE.
 *
 * @module dsh-zhouli
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Loader-visible plugin name. */
export const name = 'dsh-zhouli'

/** Only the tool registry is needed; this row provides no service and needs no realm. */
export const inject = ['tools']

/** Where the corpus lives, and how much of it one call may return. */
export const Config = z.object({
  dataDir: z
    .string()
    .description('Directory holding zhouli.json, zhiguan.json and stats.json. Defaults to the data/ shipped beside lib/.'),
  maxResults: z
    .number()
    .description('Upper bound on rows returned by one call. Defaults to 20.'),
})

/** The data directory shipped inside this package. */
const PACKAGE_DATA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data')

/** The six chapters, in order, for coordinate resolution by index. */
const CHAPTER_NAMES = ['天官冢宰', '地官司徒', '春官宗伯', '夏官司馬', '秋官司寇', '冬官考工記']

/** Cached corpus, keyed by the directory it was read from. */
let cached = null

/**
 * Read and cache the corpus. Throws an actionable message when it is absent, so
 * a misconfigured row reads as setup guidance rather than a stack trace.
 * @param dataDir - directory holding the three JSON files.
 * @returns the parsed corpus.
 */
function loadCorpus(dataDir) {
  if (cached && cached.dir === dataDir) return cached
  const read = (file) => {
    const path = join(dataDir, file)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  const main = read('zhouli.json')
  const officers = read('zhiguan.json')
  const stats = read('stats.json')
  if (!main) {
    cached = null
    throw new Error(
      `《周礼》语料未找到：${join(dataDir, 'zhouli.json')}\n`
      + 'Run scripts/fetch_corpus.py then scripts/build_corpus.py to build it, '
      + 'or point config.dataDir at a built data directory.',
    )
  }
  cached = { dir: dataDir, main, officers, stats }
  return cached
}

/** Resolution of one chapter argument: exact name, simplified name, or 1-based ordinal. */
function resolveChapter(corpus, key) {
  if (key === undefined || key === null || key === '') return null
  const text = String(key).trim()
  const chapters = corpus.main['篇'] || []
  const exact = chapters.find(
    (c) => c['篇名'] === text || c['简体篇名'] === text || String(c['序号']) === text,
  )
  if (exact) return exact
  const partial = chapters.find((c) => c['篇名'].includes(text) || c['简体篇名'].includes(text))
  if (partial) return partial
  const ordinal = Number.parseInt(text, 10)
  if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= chapters.length) {
    return chapters[ordinal - 1]
  }
  throw new Error(`未知篇目「${key}」。可用：${chapters.map((c) => c['篇名']).join('、')}`)
}

/** Every paragraph of the corpus, annotated with its chapter. */
function eachParagraph(corpus) {
  const rows = []
  for (const chapter of corpus.main['篇'] || []) {
    for (const para of chapter['段落'] || []) rows.push({ chapter, para })
  }
  return rows
}

/** All match offsets of one literal needle inside a string. */
function findSpans(text, needle) {
  const spans = []
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) return spans
    spans.push([at, at + needle.length])
    from = at + 1
  }
}

/** A window of text around a match, with the match bracketed by 【】. */
function snippet(text, start, end, pad = 18) {
  const lo = Math.max(0, start - pad)
  const hi = Math.min(text.length, end + pad)
  return `${lo > 0 ? '…' : ''}${text.slice(lo, start)}【${text.slice(start, end)}】`
    + `${text.slice(end, hi)}${hi < text.length ? '…' : ''}`
}

/** A citation label for one paragraph, e.g. `《周礼·天官冢宰》1.1`. */
function cite(chapter, para) {
  const officer = para['职官序']
  const label = officer === 0 ? `${chapter['序号']}.0（叙官）` : `${chapter['序号']}.${officer}`
  return `《周礼·${chapter['篇名']}》${label}`
}

/** `action: search` — literal search across traditional then simplified text. */
function actionSearch(corpus, args, limit) {
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('search 需要 query 参数')
  const scope = resolveChapter(corpus, args.chapter)
  const hits = []
  for (const { chapter, para } of eachParagraph(corpus)) {
    if (scope && chapter['篇名'] !== scope['篇名']) continue
    // Traditional first; the simplified half is a fallback so one hit is not counted twice.
    let field = '繁体'
    let spans = findSpans(para['繁体'], query)
    if (spans.length === 0) {
      field = '简体'
      spans = findSpans(para['简体'], query)
    }
    for (const [start, end] of spans) hits.push({ chapter, para, field, start, end })
    if (hits.length > limit * 4) break
  }
  const lines = [`命中 ${hits.length} 处${scope ? `（限 ${scope['篇名']}）` : ''}。`]
  for (const hit of hits.slice(0, limit)) {
    lines.push('', `[${cite(hit.chapter, hit.para)} §${hit.para['段序']}]`
      + (hit.field === '简体' ? '（简体文匹配）' : ''))
    lines.push(`  ${snippet(hit.para[hit.field], hit.start, hit.end)}`)
  }
  if (hits.length > limit) lines.push('', `… 余下 ${hits.length - limit} 处未显示。`)
  return lines.join('\n')
}

/** `action: para` — one paragraph by `篇序.职官序` coordinate, traditional beside simplified. */
function actionPara(corpus, args) {
  const raw = String(args.coordinate ?? '').trim()
  const match = /^(\d+)\s*[.．]\s*(\d+)$/.exec(raw)
  if (!match) throw new Error('para 需要 coordinate，形如 1.1（篇序.职官序）')
  const chapter = resolveChapter(corpus, match[1])
  const want = Number.parseInt(match[2], 10)
  const para = (chapter['段落'] || []).find((p) => p['职官序'] === want)
  if (!para) {
    const available = (chapter['段落'] || []).map((p) => p['职官序']).join(', ')
    throw new Error(`${chapter['篇名']} 无职官序 ${want}。该篇可用：${available}`)
  }
  return [
    `${cite(chapter, para)}  §${para['段序']}`,
    '',
    `繁体：${para['繁体']}`,
    '',
    `简体：${para['简体']}`,
  ].join('\n')
}

/** `action: zhiguan` — one office's establishment and duty across every chapter that has it. */
function actionZhiguan(corpus, args, limit) {
  const query = String(args.query ?? '').trim()
  const offices = (corpus.officers && corpus.officers['职官']) || []
  const found = query
    ? offices.filter((o) => o['职官'].includes(query) || (o['简体'] || '').includes(query))
    : offices
  if (found.length === 0) throw new Error(`未找到职官「${query}」`)
  const lines = [`职官 ${found.length} 项。`]
  for (const office of found.slice(0, limit)) {
    lines.push('', '='.repeat(50))
    lines.push(`职官：${office['职官']}（简体 ${office['简体']}）    所属：${office['篇'].join('、')}`)
    for (const entry of office['条目'] || []) {
      lines.push(`  【${entry['篇']} ${entry['篇序']}.${entry['职官序']}】`)
      lines.push(`    员额：${entry['员额'] || '（未见于叙官）'}`)
      lines.push(`    职掌：${entry['职掌']}`)
    }
  }
  if (found.length > limit) lines.push('', `… 余下 ${found.length - limit} 项未显示。`)
  return lines.join('\n')
}

/** `action: list` — the offices of one chapter, or of every chapter. */
function actionList(corpus, args, limit) {
  const scope = resolveChapter(corpus, args.chapter)
  const chapters = scope ? [scope] : corpus.main['篇'] || []
  const lines = []
  for (const chapter of chapters) {
    const officers = chapter['职官'] || []
    lines.push(`${chapter['篇名']}第${chapter['序号']}（${officers.length} 职官）`
      + `——汉字 ${chapter['汉字数']}，段 ${chapter['段数']}`)
    lines.push(`  ${officers.slice(0, limit).map((o) => o['职官']).join('、')}`)
    if (officers.length > limit) lines.push(`  … 余下 ${officers.length - limit} 个未显示。`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** `action: chapter` — the paragraph texts of one chapter. */
function actionChapter(corpus, args, limit) {
  const chapter = resolveChapter(corpus, args.chapter)
  if (!chapter) throw new Error('chapter 需要 chapter 参数（篇名或 1-6）')
  const paras = chapter['段落'] || []
  const lines = [`《周礼》${chapter['篇名']}第${chapter['序号']}`
    + `——汉字 ${chapter['汉字数']}，段 ${chapter['段数']}，职官 ${chapter['职官数']}`]
  for (const para of paras.slice(0, limit)) {
    lines.push(`§${para['段序']} ${chapter['序号']}.${para['职官序']}  ${para['繁体']}`)
  }
  if (paras.length > limit) lines.push(`… 余下 ${paras.length - limit} 段未显示。`)
  return lines.join('\n')
}

/** `action: stats` — corpus provenance and size, so a citation's scope is visible. */
function actionStats(corpus) {
  const stats = corpus.stats || {}
  const lines = ['《周礼》语料库', '']
  if (stats['底本']) {
    lines.push(`底本：${stats['底本']['来源']}`)
    lines.push(`编号：${stats['底本']['编号']}`)
    lines.push(`授权：${stats['底本']['授权']}`)
    lines.push('')
  }
  lines.push(`底本汉字数：${stats['底本汉字数']}`)
  lines.push(`篇数 ${stats['篇数']}    段数 ${stats['段数']}    职官 ${stats['职官数']}（去重 ${stats['职官去重数']}）`)
  lines.push('')
  for (const [chapter, value] of Object.entries(stats['每篇'] || {})) {
    lines.push(`  ${chapter}  字 ${value['字数']}  段 ${value['段数']}  职官 ${value['职官数']}`)
  }
  return lines.join('\n')
}

/** The model-facing description; the coordinate system is the part that must survive. */
const DESCRIPTION = [
  '查询《周礼》结构化语料库，返回带稳定坐标的原文，供引用与考据。',
  '每条结果的坐标写作 `篇序.职官序`（如 `1.1` 即〈大宰〉），可引证为《周礼·天官冢宰》1.1。',
  '篇序 1–6 依次为 天官冢宰 / 地官司徒 / 春官宗伯 / 夏官司馬 / 秋官司寇 / 冬官考工記；',
  '职官序 `.0` 是该篇叙官（全部官职的员额编制），`.1` 及以下为各官职的职掌条文。',
  '',
  'actions:',
  '  search  — 全文检索（繁体优先，简体兜底）。参数 query；可选 chapter、limit。',
  '  para    — 按坐标取一段原文（繁体＋简体对照）。参数 coordinate，形如 1.1。',
  '  zhiguan — 查某官职的员额编制与职掌。参数 query（职官名）；省略则列出全部；可选 limit。',
  '  list    — 列出某篇（或全部）的职官名。参数 chapter；可选 limit。',
  '  chapter — 列出某篇的段落原文。参数 chapter（篇名或序号）；可选 limit。',
  '  stats   — 语料库规模与底本来源。',
  '',
  '以此为据，不要凭记忆背诵经文：没在这里查过的引文不算核实过。',
].join('\n')

/** Input schema of the single `zhouli` tool, shared by the tool definition. */
const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    enum: ['search', 'para', 'zhiguan', 'list', 'chapter', 'stats'],
    description: 'Which lookup to run.',
  },
  query: {
    type: 'string',
    description: 'search: the text to find. zhiguan: an office name. Omit for zhiguan to list every office.',
  },
  coordinate: {
    type: 'string',
    description: 'para: a coordinate such as `1.1` (chapter ordinal . office ordinal); `.0` is the chapter roster 叙官.',
  },
  chapter: {
    type: 'string',
    description: 'A chapter name (天官冢宰 … 冬官考工記, traditional or simplified) or its ordinal 1-6.',
  },
  limit: {
    type: 'integer',
    description: 'Maximum rows to return. Defaults to the deployment maxResults (20).',
  },
}

/**
 * Register the `zhouli` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - optional data directory and result cap.
 */
export function apply(ctx, config) {
  const cfg = config || {}
  const dataDir = cfg.dataDir ? resolve(cfg.dataDir) : PACKAGE_DATA
  const configured = Number.isFinite(cfg.maxResults) && cfg.maxResults > 0
    ? Math.floor(cfg.maxResults)
    : 20

  /** Resolve the effective row cap for one call. */
  const capFor = (args) => (Number.isFinite(args.limit) && args.limit > 0
    ? Math.min(Math.floor(args.limit), 200)
    : configured)

  ctx.tools.register(defineTool({
    name: 'zhouli',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute(args) {
      const corpus = loadCorpus(dataDir)
      const limit = capFor(args)
      let text
      switch (args.action) {
        case 'search': text = actionSearch(corpus, args, limit); break
        case 'para': text = actionPara(corpus, args); break
        case 'zhiguan': text = actionZhiguan(corpus, args, limit); break
        case 'list': text = actionList(corpus, args, limit); break
        case 'chapter': text = actionChapter(corpus, args, limit); break
        case 'stats': text = actionStats(corpus); break
        default: throw new Error(`未知 action「${args.action}」`)
      }
      // The tool result is a plain owned object; no live runtime data crosses it.
      return Promise.resolve({ text })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `周礼 · ${args.action}`,
      kind: 'read',
      rawInput: args,
    }),
  }))
}
