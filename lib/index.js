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
    .description('Directory holding zhouli.json, zhiguan.json, jiaokan.json and stats.json. Defaults to the data/ shipped beside lib/.'),
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
  const jiaokan = read('jiaokan.json')
  const stats = read('stats.json')
  if (!main) {
    cached = null
    throw new Error(
      `《周礼》语料未找到：${join(dataDir, 'zhouli.json')}\n`
      + 'Run scripts/fetch_corpus.py then scripts/build_corpus.py to build it, '
      + 'or point config.dataDir at a built data directory.',
    )
  }
  cached = { dir: dataDir, main, officers, jiaokan, stats }
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

/**
 * The duty text of one office entry, taken from the main corpus when it is
 * there. `zhiguan.json` is an index and has shipped a truncated 职掌 before;
 * `zhouli.json` always carries the whole paragraph, so prefer it and a short
 * index entry can never be returned as if it were the full duty.
 */
function fullDuty(corpus, entry) {
  const chapter = (corpus.main['篇'] || []).find((c) => c['序号'] === entry['篇序'])
  const office = chapter && (chapter['职官'] || []).find((o) => o['序号'] === entry['职官序'])
  return (office && office['职掌']) || entry['职掌'] || ''
}

/** The collation notes of one chapter, as recorded against the 郑玄注本 witness. */
function collationOf(corpus, chapter) {
  const witness = ((corpus.jiaokan && corpus.jiaokan[chapter['篇名']]) || {})['郑玄注本']
  if (!witness) return null
  return { 锚点数: witness['锚点数'] || 0, 事件: witness['事件'] || [] }
}

/**
 * Collation offsets index into the chapter's punctuation-free simplified text,
 * so the same normalisation has to be applied before a span can be located.
 */
function stripPunct(text) {
  return text.replace(/[\p{P}\p{Z}\s]/gu, '')
}

/** Every paragraph's span inside that punctuation-free simplified chapter text. */
function paragraphSpans(chapter) {
  const spans = []
  let at = 0
  for (const para of chapter['段落'] || []) {
    const length = stripPunct(para['简体']).length
    spans.push({ para, start: at, end: at + length })
    at += length
  }
  return spans
}

/** The paragraph span one collation event falls in, or null when it falls in none. */
function spanOfEvent(spans, event) {
  const length = Math.max((event['底本'] || '').length, 1)
  return spans.find((s) => event['pos'] < s.end && event['pos'] + length > s.start) || null
}

/** Whether one collation event's span touches `[start, end)`. */
function overlaps(event, start, end) {
  const length = Math.max((event['底本'] || '').length, 1)
  return event['pos'] < end && event['pos'] + length > start
}

/** One collation row, in the shape a citation note takes. */
function variantLine(event) {
  return `  [${event['kind']}] 底本「${event['底本']}」／郑玄注本「${event['异本']}」`
}

/**
 * Locate a phrase inside a chapter's punctuation-free text. Collation offsets are
 * counted per chapter, and here the two scripts are character-for-character
 * conversions of each other, so a span found in either one addresses the same
 * offsets — which is what lets a traditional quotation be checked against them.
 * @returns `{start, end, total}` for the first occurrence, or null when absent.
 */
function locatePhrase(chapter, needle) {
  if (!needle) return null
  const paras = chapter['段落'] || []
  const texts = [paras.map((p) => p['繁体']).join(''), paras.map((p) => p['简体']).join('')]
  for (const raw of texts) {
    const text = stripPunct(raw)
    const at = text.indexOf(needle)
    if (at >= 0) return { start: at, end: at + needle.length, total: findSpans(text, needle).length }
  }
  return null
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
      lines.push(`    职掌：${fullDuty(corpus, entry)}`)
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

/** `action: jiaokan` — collation notes, so a citation can state any variant reading. */
function actionJiaokan(corpus, args, limit) {
  const chapters = corpus.main['篇'] || []
  const coordinate = String(args.coordinate ?? '').trim()

  // One paragraph: is anything in it written differently by the other witness?
  if (coordinate) {
    const match = /^(\d+)\s*[.．]\s*(\d+)$/.exec(coordinate)
    if (!match) throw new Error('jiaokan 需要 coordinate，形如 1.1（篇序.职官序）')
    const chapter = resolveChapter(corpus, match[1])
    const want = Number.parseInt(match[2], 10)
    const span = paragraphSpans(chapter).find((s) => s.para['职官序'] === want)
    if (!span) throw new Error(`${chapter['篇名']} 无职官序 ${want}`)
    const notes = collationOf(corpus, chapter)
    const lines = [`${cite(chapter, span.para)}  §${span.para['段序']}  勘记（底本 vs 郑玄注本）`]
    if (!notes) {
      lines.push('', '本篇无勘记数据（jiaokan.json 缺失或缺此篇）。')
      return lines.join('\n')
    }
    const inside = notes['事件'].filter((e) => overlaps(e, span.start, span.end))
    if (inside.length === 0) {
      lines.push('', '此段无异文：底本与郑玄注本全同，可径引。')
    } else {
      lines.push('', `此段有异文 ${inside.length} 条（段内合计，未必即在你所引之句上）`
        + ' —— 引用时须说明两本之别：')
      for (const event of inside) lines.push(variantLine(event))
    }
    return lines.join('\n')
  }

  const scope = resolveChapter(corpus, args.chapter)

  // A quoted line: report only the variants that fall on the quoted span itself.
  const query = String(args.query ?? '').trim()
  if (query) {
    const needle = stripPunct(query)
    for (const chapter of (scope ? [scope] : chapters)) {
      const located = locatePhrase(chapter, needle)
      if (!located) continue
      const notes = collationOf(corpus, chapter)
      const lines = [`《周礼·${chapter['篇名']}》 引句「${query}」`
        + `（下标 ${located.start}-${located.end}`
        + `${located.total > 1 ? `；本篇共 ${located.total} 处，此为第一处` : ''}）`]
      if (!notes) {
        lines.push('', '本篇无勘记数据（jiaokan.json 缺失或缺此篇）。')
        return lines.join('\n')
      }
      const inside = notes['事件'].filter((e) => overlaps(e, located.start, located.end))
      if (inside.length === 0) {
        lines.push('', '此句无异文：底本与郑玄注本全同，可径引。')
      } else {
        lines.push('', `此句有异文 ${inside.length} 条 —— 引用时须说明两本之别：`)
        for (const event of inside) lines.push(variantLine(event))
      }
      return lines.join('\n')
    }
    throw new Error(`未在正文中定位「${query}」。可先用 search 查其所在，或改用 coordinate。`)
  }

  // One chapter: its totals, then the first rows, each carrying its own coordinate.
  if (scope) {
    const notes = collationOf(corpus, scope)
    if (!notes) throw new Error(`《${scope['篇名']}》无勘记数据（jiaokan.json 缺失或缺此篇）`)
    const spans = paragraphSpans(scope)
    const lines = [`《周礼·${scope['篇名']}》 勘记：锚点 ${notes['锚点数']}，`
      + `异文 ${notes['事件'].length} 条`]
    for (const event of notes['事件'].slice(0, limit)) {
      const span = spanOfEvent(spans, event)
      lines.push('', `${span ? `[${cite(scope, span.para)}] ` : ''}[${event['kind']}]`
        + ` 底本「${event['底本']}」／郑玄注本「${event['异本']}」`)
    }
    if (notes['事件'].length > limit) {
      lines.push('', `… 余下 ${notes['事件'].length - limit} 条未显示。`)
    }
    return lines.join('\n')
  }

  // No scope at all: the counts of every chapter.
  const lines = ['《周礼》勘记：底本 Kanripo KR1d0001 vs 郑玄注本 KR1d0002', '']
  let total = 0
  for (const chapter of chapters) {
    const notes = collationOf(corpus, chapter)
    if (!notes) {
      lines.push(`  ${chapter['篇名']}  （无勘记数据）`)
      continue
    }
    total += notes['事件'].length
    lines.push(`  ${chapter['篇名']}  锚点 ${notes['锚点数']}  异文 ${notes['事件'].length}`)
  }
  lines.push('', `合计 ${total} 条。查某段有无异文：jiaokan + coordinate（如 1.1）。`)
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
  '  jiaokan — 查勘记：底本与郑玄注本之异文。参数 coordinate（查某段）或 query（查某句，',
  '            即你打算引的那一句）或 chapter（列某篇之异文）；皆省则报各篇之数。可选 limit。',
  '  stats   — 语料库规模与底本来源。',
  '',
  '凡引一句，先以 para 取原文，再以 jiaokan 核其有无异文；两本有出入者，引用时须据实说明。',
  '',
  '以此为据，不要凭记忆背诵经文：没在这里查过的引文不算核实过。',
].join('\n')

/** Input schema of the single `zhouli` tool, shared by the tool definition. */
const PARAMETERS = {
  action: {
    type: 'string',
    required: true,
    enum: ['search', 'para', 'zhiguan', 'list', 'chapter', 'jiaokan', 'stats'],
    description: 'Which lookup to run.',
  },
  query: {
    type: 'string',
    description: 'search: the text to find. zhiguan: an office name (omit to list every office). jiaokan: the quoted phrase to check for a variant reading.',
  },
  coordinate: {
    type: 'string',
    description: 'para: a coordinate such as `1.1` (chapter ordinal . office ordinal); `.0` is the chapter roster 叙官. jiaokan: the same coordinate restricts the collation to that paragraph.',
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
        case 'jiaokan': text = actionJiaokan(corpus, args, limit); break
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
