<#
.SYNOPSIS
    《周礼》语料库检索入口（中文命令行）。

.DESCRIPTION
    对 data\structured\ 下的结构化语料执行检索、职官查询、篇目浏览与校勘查看。
    底层调用 scripts\zhouli.py（仅依赖 Python 标准库）。

.PARAMETER Command
    统计 | 检索 | 职官 | 浏览 | 段落 | 校勘

.PARAMETER Argument
    检索关键词 / 职官名 / 篇名 / 段落节点号

.PARAMETER 篇
    限定篇目，如 「天官冢宰」。

.PARAMETER 数量
    显示条数上限，默认 20。

.PARAMETER 列表
    职官命令下：列出全部职官。

.PARAMETER Json
    检索命令下：以 JSON 输出。

.EXAMPLE
    .\检索.ps1 统计

.EXAMPLE
    .\检索.ps1 检索 大宰 --数量 5

.EXAMPLE
    .\检索.ps1 检索 「之职」 -篇 天官冢宰 -数量 30

.EXAMPLE
    .\检索.ps1 职官 大宰

.EXAMPLE
    .\检索.ps1 职官 -列表 -篇 地官

.EXAMPLE
    .\检索.ps1 浏览 冬官考工记

.EXAMPLE
    .\检索.ps1 段落 1.1

.EXAMPLE
    .\检索.ps1 叙官 天官冢宰

.EXAMPLE
    .\检索.ps1 校勘 -篇 天官冢宰 -数量 20

.NOTES
    若脚本被禁用，请先执行：
        Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
    或以 .\检索.ps1 之外的方式运行：
        powershell -ExecutionPolicy Bypass -File .\检索.ps1 统计

    本文件必须以「带 BOM 的 UTF-8」保存。Windows PowerShell 5.1 在没有 BOM 时按系统
    ANSI 代码页解码 .ps1，本文件里的中文命令名会立即变成乱码并使脚本无法解析。
    若你的编辑器删掉了 BOM，请重新加上（见 README「开发」一节）。
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('统计', '检索', '职官', '浏览', '段落', '叙官', '校勘')]
    [string]$Command,

    [Parameter(Position = 1)]
    [string]$Argument,

    [Parameter()]
    [string]$篇,

    [Parameter()]
    [ValidateRange(1, 100000)]
    [int]$数量 = 20,

    [Parameter()]
    [switch]$列表,

    [Parameter()]
    [switch]$Json
)

if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw "此脚本需要 PowerShell 5.0 或更高版本。当前版本：$($PSVersionTable.PSVersion)"
}

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

# --- 定位解释器与脚本 ---
$python = (Get-Command -Name 'python' -ErrorAction SilentlyContinue)
if (-not $python) {
    $python = (Get-Command -Name 'py' -ErrorAction SilentlyContinue)
}
if (-not $python) {
    throw '未找到 Python 解释器（python / py）。请先安装 Python 3 并加入 PATH。'
}

if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    throw '无法确定脚本所在目录（$PSScriptRoot 为空）。请以文件方式运行本脚本。'
}

$engine = Join-Path -Path $PSScriptRoot -ChildPath 'scripts\zhouli.py'
if (-not (Test-Path -Path $engine)) {
    throw "缺少检索引擎：$engine"
}

$dataFile = Join-Path -Path $PSScriptRoot -ChildPath 'data\zhouli.json'
if (-not (Test-Path -Path $dataFile)) {
    throw "语料尚未构建，缺少：$dataFile`n请先运行：python scripts\build_corpus.py"
}

# --- 组装参数 ---
$argv = New-Object -TypeName 'System.Collections.Generic.List[string]'

switch ($Command) {
    '统计' { $argv.Add('stats') }
    '检索' {
        if ([string]::IsNullOrWhiteSpace($Argument)) { throw '「检索」需要一个关键词参数。' }
        $argv.Add('search')
        $argv.Add($Argument)
    }
    '职官' {
        $argv.Add('zhiguan')
        if ($列表) {
            $argv.Add('--list')
        }
        elseif (-not [string]::IsNullOrWhiteSpace($Argument)) {
            $argv.Add($Argument)
        }
        else {
            throw '「职官」需要职官名，或使用 -列表 查看全部。'
        }
    }
    '浏览' {
        if ([string]::IsNullOrWhiteSpace($Argument)) { throw '「浏览」需要一个篇名参数。' }
        $argv.Add('chapter')
        $argv.Add($Argument)
    }
    '段落' {
        if ([string]::IsNullOrWhiteSpace($Argument)) { throw '「段落」需要定位，如 1.1（篇序.职官序）。' }
        $argv.Add('para')
        $argv.Add($Argument)
    }
    '叙官' {
        if ([string]::IsNullOrWhiteSpace($Argument)) { throw '「叙官」需要一个篇名参数。' }
        $argv.Add('staff')
        $argv.Add($Argument)
    }
    '校勘' {
        $argv.Add('jiaokan')
    }
}

if (-not [string]::IsNullOrWhiteSpace($篇)) {
    $argv.Add('--篇')
    $argv.Add($篇)
}
if ($Command -in @('检索', '浏览', '校勘')) {
    $argv.Add('--limit')
    $argv.Add([string]$数量)
}
if ($Json -and $Command -eq '检索') {
    $argv.Add('--json')
}

Write-Verbose ("执行：{0} {1} {2}" -f $python.Source, $engine, ($argv -join ' '))

try {
    & $python.Source $engine @argv
    $code = $LASTEXITCODE
}
catch {
    $exType = $_.Exception.GetType().FullName
    Write-Error ("检索执行失败（{0}）：{1}" -f $exType, $_.Exception.Message)
    throw
}

if ($code -ne 0) {
    Write-Error "检索引擎返回非零退出码：$code"
    exit $code
}
