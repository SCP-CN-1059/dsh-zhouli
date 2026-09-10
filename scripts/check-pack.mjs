/**
 * Pre-publish guard: assert the npm tarball ships the corpus and nothing it must not.
 *
 * This exists because `.gitignore` does not constrain npm. `files` does. Listing a
 * whole directory (`"data"`) therefore packs whatever happens to be sitting in it —
 * which for a working checkout is `data/raw/`, the fetched sources. Two of those,
 * 殆知阁's 白文 and 周礼注疏, are under no declared license and NOTICE promises
 * this project does not redistribute them. A build that ships them anyway would
 * break that promise silently, in the one artifact users actually download.
 *
 * So the tarball is checked, not assumed: forbidden prefixes must be absent and
 * the files the plugin reads at runtime must be present.
 *
 * Run directly, or as `prepublishOnly`:
 *   node scripts/check-pack.mjs
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Paths that must never appear in the published tarball. */
const FORBIDDEN = [
  { prefix: 'data/raw/', why: 'upstream sources — NOTICE promises they are not redistributed' },
  { prefix: 'scripts/__pycache__/', why: 'byte-code caches' },
  { suffix: '.pyc', why: 'byte-code caches' },
  { prefix: 'node_modules/', why: 'dependencies are resolved at install time' },
  { prefix: 'test/', why: 'repo-only, and .mjs tests need peer deps a user may not have' },
]

/** Paths the published package cannot work without. */
const REQUIRED = [
  'package.json',
  'lib/index.js',
  'cordis.patch.yml',
  'data/zhouli.json',
  'data/zhiguan.json',
  'data/jiaokan.json',
  'data/stats.json',
  'preset/agent.cordis.yml',
  'preset/preset.yml',
  'preset/skills/zhouli/SKILL.md',
  'NOTICE',
  'README.md',
  '检索.ps1',
]

/** Run npm without a shell, so arguments are never concatenated into a command line. */
function runNpm(args) {
  const options = { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  const execpath = process.env.npm_execpath
  // `npm run` sets npm_execpath to npm's own entry point; running that under node
  // avoids both a shell and the .cmd-not-executable problem on Windows.
  if (execpath && execpath.endsWith('.js')) {
    return execFileSync(process.execPath, [execpath, ...args], options)
  }
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'npm', ...args], options)
  }
  return execFileSync('npm', args, options)
}

/** Read the dry-run tarball manifest npm would actually pack. */
function packManifest() {
  const raw = runNpm(['pack', '--dry-run', '--json'])
  // npm may print notice lines before the JSON; take the first JSON array.
  const start = raw.indexOf('[')
  if (start < 0) throw new Error(`unexpected npm output:\n${raw.slice(0, 400)}`)
  return JSON.parse(raw.slice(start))[0]
}

const entry = packManifest()
const paths = entry.files.map((file) => file.path)
const problems = []

for (const path of paths) {
  for (const rule of FORBIDDEN) {
    const hit = rule.prefix ? path.startsWith(rule.prefix) : path.endsWith(rule.suffix)
    if (hit) problems.push(`forbidden in tarball: ${path}  (${rule.why})`)
  }
}
for (const path of REQUIRED) {
  if (!paths.includes(path)) problems.push(`missing from tarball: ${path}`)
}

console.log(`${entry.name}@${entry.version}  ${paths.length} files  `
  + `${(entry.size / 1024 / 1024).toFixed(1)} MB packed, `
  + `${(entry.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked`)

if (problems.length > 0) {
  console.error('\npack check FAILED:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('pack check passed: forbidden paths absent, runtime files present')
