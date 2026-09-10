/**
 * Smoke test for the dsh-zhouli plugin.
 *
 * Exercises the plugin without booting a harness: it imports the module, calls
 * `apply` against a stub tool registry, and runs every action through the
 * registered tool's `execute`. The assert here is that a citation the plugin
 * hands back actually exists in the corpus — the same property the model is
 * told to rely on.
 *
 * Setup (the peer deps must resolve):
 *   npm install            # or link @deepseek-ai/{cordis,dsh-tools,schemastery}
 * Run:
 *   node test/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { apply, name, inject, Config } from '../lib/index.js'

let failures = 0

/** Assert one condition, printing a pass/fail line. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const registered = []
const ctx = { tools: { register(tool) { registered.push(tool); return () => {} } } }

console.log(`plugin ${name}  inject=${JSON.stringify(inject)}`)
console.log(`config keys: ${Object.keys(Config.dict ?? {})}`)

apply(ctx, {})
check('registers exactly one tool', registered.length === 1, `got ${registered.length}`)

const tool = registered[0]
check('tool is named zhouli', tool.name === 'zhouli', tool.name)

/** Run one action and return its text. */
async function run(args) {
  const value = await tool.execute(args, {})
  if (typeof value?.text !== 'string') throw new Error(`no text for ${JSON.stringify(args)}`)
  return value.text
}

// ── stats ───────────────────────────────────────────────────────────────────
const stats = await run({ action: 'stats' })
check('stats reports the base text size', stats.includes('49384'), stats.split('\n')[4])
check('stats names the Kanripo base edition', stats.includes('KR1d0001'))

// ── para: the citation an agent would actually emit ─────────────────────────
const para = await run({ action: 'para', coordinate: '1.1' })
check('para 1.1 is 〈大宰〉', para.includes('大宰之職，掌建邦之六典'), para.split('\n')[2]?.slice(0, 40))
check('para returns both scripts', para.includes('繁体：') && para.includes('简体：'))
check('para carries a citable label', para.includes('《周礼·天官冢宰》1.1'))

const roster = await run({ action: 'para', coordinate: '1.0' })
check('para 1.0 is the 叙官 roster', roster.includes('治官之屬') && roster.includes('（叙官）'))

// ── search: traditional and simplified both hit ─────────────────────────────
const trad = await run({ action: 'search', query: '六典', limit: 3 })
const simp = await run({ action: 'search', query: '建国', limit: 3 })
check('search matches traditional', trad.includes('命中') && trad.includes('六典'))
check('search falls back to simplified', simp.includes('简体文匹配'), simp.slice(0, 80))

// ── zhiguan: establishment and duty ─────────────────────────────────────────
const office = await run({ action: 'zhiguan', query: '大宰', limit: 1 })
check('zhiguan returns 员额', office.includes('卿一人'), office.slice(0, 120))
check('zhiguan returns 职掌', office.includes('掌建邦之六典'))

// ── list / chapter ──────────────────────────────────────────────────────────
const list = await run({ action: 'list', chapter: '冬官考工记', limit: 5 })
check('list accepts a simplified chapter name', list.includes('輪人'), list.slice(0, 80))

const chapter = await run({ action: 'chapter', chapter: '6', limit: 2 })
check('chapter accepts an ordinal', chapter.includes('冬官考工記第6'))

// ── every chapter resolves by name and by ordinal ───────────────────────────
for (const key of ['天官冢宰', '地官司徒', '春官宗伯', '夏官司馬', '秋官司寇', '冬官考工記', '1', '6']) {
  const text = await run({ action: 'list', chapter: key, limit: 1 })
  check(`chapter resolves: ${key}`, text.includes('职官'))
}

// ── the skill's quotation table must match the corpus ───────────────────────
// The preset tells the model to trust this table without re-checking, so the
// table is exactly the thing that must not drift. Parse it and look every row
// up through the same tool the model would use.
const skillPath = new URL('../preset/skills/zhouli/SKILL.md', import.meta.url)
const skillText = readFileSync(skillPath, 'utf8')
const rows = [...skillText.matchAll(
  /^\|\s*《周礼·([^》]+)》\s*(\d+\.\d+)\s*\|\s*([^|]+?)\s*\|/gm,
)].map((m) => ({ chapter: m[1], coordinate: m[2], quote: m[3] }))

check('quotation table parsed', rows.length >= 6, `got ${rows.length} rows`)
for (const row of rows) {
  const found = await run({ action: 'para', coordinate: row.coordinate })
  check(`quote ${row.coordinate} exists`, found.includes(row.quote), row.quote.slice(0, 24))
  check(`quote ${row.coordinate} is in 《${row.chapter}》`, found.includes(`《周礼·${row.chapter}》`))
}

// ── the persona's citations must match the corpus too ───────────────────────
// Extract them from the persona rather than restating them here: a hand-kept
// list drifts from the file it is supposed to guard, which is the failure this
// whole preset is about. Only 「…」 spans of eight or more characters are
// quotations — shorter ones are the term glosses like 「八法」.
const presetText = readFileSync(new URL('../preset/agent.cordis.yml', import.meta.url), 'utf8')
const personaQuotes = [...presetText.matchAll(/「([^」]{8,})」/g)].map((m) => m[1])
check('persona carries quotations', personaQuotes.length >= 4, `got ${personaQuotes.length}`)
for (const quote of personaQuotes) {
  const found = await run({ action: 'search', query: quote, limit: 1 })
  check(`persona quote exists: ${quote.slice(0, 14)}…`, !found.startsWith('命中 0 处'), found.slice(0, 40))
}

// ── error paths stay actionable rather than throwing raw ────────────────────
for (const [label, args, needle] of [
  ['unknown coordinate', { action: 'para', coordinate: '9.9' }, '未知篇目'],
  ['unknown office', { action: 'zhiguan', query: '不存在的东西' }, '未找到职官'],
  ['search without query', { action: 'search' }, '需要 query'],
]) {
  try {
    await run(args)
    check(label, false, 'no error raised')
  } catch (error) {
    check(label, error.message.includes(needle), error.message.slice(0, 60))
  }
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
