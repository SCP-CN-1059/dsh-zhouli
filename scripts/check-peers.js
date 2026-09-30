/**
 * peer 范围覆盖核查。
 *
 * 判定口径：范围须覆盖「不低于其声明下限」的全部已发布版本。
 * 低于下限的旧版本被排除是语义正确的（范围本就是在表达「至少这么新」），
 * 不算遗漏 —— 否则会把有意的取舍误报成缺陷。
 *
 * semver 的预发布规则使得「覆盖未来新元组」无法一劳永逸，故这个脚本要
 * 定期重跑：harness 每发一个新的预发布元组，就得为它添一个 || 分支。
 *
 * 用法：node scripts/check-peers.js
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))

/**
 * `semver` 不在本包的依赖里，但它随 npm 一起装在本机，用绝对路径取。
 * npm 自身就在 node 可执行文件旁边（Windows 上即 Program Files\nodejs\node_modules\npm），
 * 所以从 process.execPath 推导最可靠；`npm root -g` 指向的是全局包目录，不是这里。
 */
function loadSemver() {
  try {
    return require('semver')
  } catch { /* 继续找 */ }
  const nodeDir = dirname(process.execPath)
  const tries = [
    join(nodeDir, 'node_modules', 'npm', 'node_modules', 'semver'),
    join(nodeDir, 'lib', 'node_modules', 'npm', 'node_modules', 'semver'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'node_modules', 'semver'),
  ]
  for (const p of tries) {
    try {
      return require(p)
    } catch { /* 继续找 */ }
  }
  throw new Error('找不到 semver。已试过：\n  ' + tries.join('\n  '))
}

const semver = loadSemver()

/** 从范围里取出声明下限：`>=X` 或 `^X` 中的最小者。 */
function floorOf(range) {
  const candidates = []
  for (const m of range.matchAll(/[>^]=\s*([0-9][^\s|]*)/g)) candidates.push(m[1])
  for (const m of range.matchAll(/\^\s*([0-9][^\s|]*)/g)) candidates.push(m[1])
  if (candidates.length === 0) return null
  return candidates.sort(semver.compare)[0]
}

/** 该版本是否不低于下限（比较时忽略自身的预发布标签）。 */
function atOrAbove(version, floor) {
  const strip = (v) => v.replace(/-.*$/, '')
  return semver.gte(strip(version), strip(floor))
}

/** 不带 shell 地运行 npm：Windows 上 .cmd 不能直接 spawn，需经 cmd.exe。 */
function runNpm(args) {
  const options = { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/c', 'npm', ...args], options)
  }
  return execFileSync('npm', args, options)
}

function publishedVersions(name) {
  return JSON.parse(runNpm(['view', name, 'versions', '--json']))
}

let allOk = true
console.log('=== peer 范围覆盖核查 ===')
for (const [name, range] of Object.entries(pkg.peerDependencies)) {
  const versions = publishedVersions(name)
  const floor = floorOf(range)
  const inScope = versions.filter((v) => atOrAbove(v, floor))
  const missed = inScope.filter((v) => !semver.satisfies(v, range))
  const latest = versions[versions.length - 1]
  const latestOk = semver.satisfies(latest, range)

  console.log(`\n  ${name}`)
  console.log(`    下限 ${floor}  已发布 ${versions.length} 个，其中不低于下限的 ${inScope.length} 个`)
  console.log(`    未覆盖（不低于下限者）: ${missed.length ? missed.join(', ') : '无'}`)
  console.log(`    最新版 ${latest} 被覆盖: ${latestOk}`)
  const below = versions.filter((v) => !atOrAbove(v, floor))
  if (below.length) console.log(`    低于下限故有意排除: ${below.join(', ')}`)

  if (missed.length || !latestOk) {
    allOk = false
    console.log('    → 需为这些元组补 || 分支')
  }
}
console.log('\n结论：' + (allOk ? '全部覆盖下限及以上所有版本 ✓' : '仍有不低于下限的版本未覆盖 ✗'))
process.exit(allOk ? 0 : 1)
