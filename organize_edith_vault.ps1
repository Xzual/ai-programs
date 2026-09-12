$ErrorActionPreference = 'Stop'

$IWithDot = [char]0x0130
$Root = "D:\ED${IWithDot}TH\ED${IWithDot}TH"
$Now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Read-Text {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path)
}

function Ensure-Note {
    param([string]$Path, [string]$Content)
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Utf8NoBom -Path $Path -Content $Content
        return $true
    }
    return $false
}

function Upsert-Exact {
    param([string]$Path, [string]$Content)
    if ((Test-Path -LiteralPath $Path) -and ((Read-Text $Path) -eq $Content)) {
        return $false
    }
    Write-Utf8NoBom -Path $Path -Content $Content
    return $true
}

function Has-Frontmatter {
    param([string]$Text)
    return $Text.StartsWith("---`r`n") -or $Text.StartsWith("---`n")
}

function Add-FrontmatterIfMissing {
    param(
        [string]$Path,
        [string]$Type,
        [string[]]$Tags,
        [string]$Status = 'active',
        [string]$BelongsTo = ''
    )
    $text = Read-Text $Path
    if (Has-Frontmatter $text) { return $false }
    $created = (Get-Item -LiteralPath $Path).CreationTime.ToString('yyyy-MM-dd')
    $updated = (Get-Item -LiteralPath $Path).LastWriteTime.ToString('yyyy-MM-dd')
    $title = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $tagBlock = ($Tags | ForEach-Object { "  - $_" }) -join "`n"
    $belongs = if ($BelongsTo) { "belongs_to: `"[[${BelongsTo}]]`"`n" } else { "" }
    $fm = @"
---
type: $Type
source: obsidian
status: $Status
tags:
$tagBlock
created: $created
updated: $updated
$belongs---

"@
    Write-Utf8NoBom -Path $Path -Content ($fm + $text)
    return $true
}

$Created = New-Object System.Collections.Generic.List[string]
$Modified = New-Object System.Collections.Generic.List[string]

function Track-Create {
    param([string]$Path, [string]$Content)
    if (Ensure-Note -Path $Path -Content $Content) { $Created.Add($Path) }
}

function Track-Upsert {
    param([string]$Path, [string]$Content)
    $exists = Test-Path -LiteralPath $Path
    if (Upsert-Exact -Path $Path -Content $Content) {
        if ($exists) { $Modified.Add($Path) } else { $Created.Add($Path) }
    }
}

$MainIndex = @"
---
type: index
source: obsidian
status: active
tags:
  - edith
  - source
created: 2026-09-09
updated: 2026-09-10
---

# E.D.I.T.H. Index

This is the main knowledge map entry point for E.D.I.T.H.'s external brain.

## Core Areas
- [[Memory]] -> [[Memory Index]]
- [[Projects]] -> [[Projects Index]]
- [[Tasks]] -> [[Tasks Index]]
- [[Research]] -> [[Research Index]]
- [[Trading]] -> [[Trading Index]]
- [[Conversations]] -> [[Conversations Index]]
- [[People]] -> [[People Index]]
- [[Organizations]] -> [[Organizations Index]]
- [[Meetings]] -> [[Meetings Index]]

## Active Knowledge Maps
- [[Crypto Market Learning Index]]
- [[Needs Review]]

## E.D.I.T.H. Operating Rules
- Preserve existing notes and links.
- Use frontmatter to show type, status, tags, created date, and updated date.
- Put unclear, duplicate-looking, or sensitive-looking items in [[Needs Review]] instead of deleting them.
- Keep secrets out of notes. Redact API keys, tokens, passwords, and private keys if found.
"@
Track-Upsert -Path (Join-Path $Root 'E.D.I.T.H. Index.md') -Content $MainIndex

$folderData = @(
    @{Name='Memory'; Type='memory'; Tags=@('edith','memory'); Description='Stable memories, preferences, facts, and long-term context E.D.I.T.H. can reuse.'},
    @{Name='Projects'; Type='project'; Tags=@('edith','project'); Description='Active and archived E.D.I.T.H. projects and related workstreams.'},
    @{Name='Tasks'; Type='task'; Tags=@('edith','task','todo'); Description='Tasks, decisions, follow-ups, and review queues.'},
    @{Name='Research'; Type='research'; Tags=@('edith','research'); Description='Research notes, sources, references, and learning material.'},
    @{Name='Trading'; Type='trading'; Tags=@('edith','trading'); Description='Trading research, crypto learning, symbols, and daily observations.'},
    @{Name='Conversations'; Type='conversation'; Tags=@('edith','conversation'); Description='Conversation records linked to memories, projects, tasks, and decisions.'},
    @{Name='People'; Type='person'; Tags=@('edith','person'); Description='People profiles and relationship/context notes.'},
    @{Name='Organizations'; Type='organization'; Tags=@('edith','organization'); Description='Organization profiles, sources, contacts, and external context.'},
    @{Name='Meetings'; Type='meeting'; Tags=@('edith','meeting'); Description='Meeting notes, summaries, decisions, and action items.'}
)

foreach ($item in $folderData) {
    $folder = Join-Path $Root $item.Name
    if (-not (Test-Path -LiteralPath $folder)) {
        New-Item -ItemType Directory -Path $folder | Out-Null
    }
    $tagBlock = ($item.Tags | ForEach-Object { "  - $_" }) -join "`n"
    $idxName = "$($item.Name) Index"
    $content = @"
---
type: index
source: obsidian
status: active
tags:
$tagBlock
created: 2026-09-10
updated: 2026-09-10
---

# $idxName

$($item.Description)

## Linked From
- [[E.D.I.T.H. Index]]
- [[$($item.Name)]]

## Notes
```dataview
TABLE status, updated, tags
FROM "$($item.Name)"
WHERE file.name != "$idxName"
SORT updated DESC, file.name ASC
```

## Needs Review
- See [[Needs Review]] for unclear, duplicate-looking, or orphaned notes.
"@
    Track-Create -Path (Join-Path $folder "$idxName.md") -Content $content

    $hubPath = Join-Path $Root "$($item.Name).md"
    if (-not (Test-Path -LiteralPath $hubPath)) {
        $hub = @"
---
type: hub
source: obsidian
status: active
tags:
$tagBlock
created: 2026-09-10
updated: 2026-09-10
---

# $($item.Name)

Main folder hub for [[$idxName]].

## Index
- [[$idxName]]
- [[E.D.I.T.H. Index]]
"@
        Track-Create -Path $hubPath -Content $hub
    }
}

$memoryHub = @"
---
type: hub
source: obsidian
status: active
tags:
  - edith
  - memory
created: 2026-09-09
updated: 2026-09-10
---

# Memory

Main memory hub for [[Memory Index]].

## Daily Memory Sources
- [[2026-09-09]]
- [[2026-09-05]]
- [[2026-09-03]]
- [[2026-09-02]]

## Related
- [[E.D.I.T.H. Index]]
- [[Trading Index]]
- [[Crypto Market Learning Index]]
"@
Track-Upsert -Path (Join-Path $Root 'Memory.md') -Content $memoryHub

$tradingHub = @"
---
type: hub
source: obsidian
status: active
tags:
  - edith
  - trading
  - crypto-learning
created: 2026-09-09
updated: 2026-09-10
---

# Trading

Main trading hub for [[Trading Index]] and [[Crypto Market Learning Index]].

## Crypto Symbols
- [[BTC-USDT]]
- [[ETH-USDT]]
- [[SOL-USDT]]
- [[BNB-USDT]]
- [[XRP-USDT]]
- [[DOGE-USDT]]
- [[AVAX-USDT]]
- [[ADA-USDT]]

## Related
- [[E.D.I.T.H. Index]]
- [[Research Index]]
- [[Tasks Index]]
"@
Track-Upsert -Path (Join-Path $Root 'Trading.md') -Content $tradingHub

$cryptoIndex = @"
---
type: index
source: obsidian
status: active
tags:
  - edith
  - trading
  - crypto-learning
created: 2026-09-10
updated: 2026-09-10
---

# Crypto Market Learning Index

Observer-only crypto learning map for E.D.I.T.H. This area is for learning and analysis, not financial advice or live trading instructions.

## Parent Hubs
- [[Trading]]
- [[Trading Index]]
- [[Research Index]]
- [[Tasks Index]]

## Daily Notes
- [[2026-09-09]]
- [[2026-09-05]]
- [[2026-09-03]]
- [[2026-09-02]]

## Symbols
- [[BTC-USDT]]
- [[ETH-USDT]]
- [[SOL-USDT]]
- [[BNB-USDT]]
- [[XRP-USDT]]
- [[DOGE-USDT]]
- [[AVAX-USDT]]
- [[ADA-USDT]]

## Supporting Notes
- [[qa-runtime-crypto-note|QA Runtime Crypto Note]]
- [[_EDITH_CRYPTO_EXPORT_TEST|E.D.I.T.H. Crypto Export Test]]

## Review
- [[Needs Review]]
"@
Track-Upsert -Path (Join-Path $Root 'Trading\Crypto Market Learning\Crypto Market Learning Index.md') -Content $cryptoIndex

$needsReview = @"
---
type: review
source: obsidian
status: active
tags:
  - edith
  - todo
created: 2026-09-10
updated: 2026-09-10
---

# Needs Review

Nothing was deleted. This note lists items that need human review before any rename, merge, archive, or cleanup.

## Audit Summary
- Vault path preserved: ``$Root``
- No files deleted.
- No folders renamed.
- No permanent moves performed.
- No obvious API keys, passwords, private keys, or provider tokens were found in Markdown content during the audit. The note `qa-runtime-crypto-note.md` already states `edith_secret_redacted: false` and says there are no secrets.

## Duplicate-Looking Or Unclear Notes
- [[Memory]] and [[Memory Index]] both now exist. `Memory.md` is kept as a root hub because existing links referenced `[[Memory]]`.
- [[Trading]] and [[Trading Index]] both now exist. `Trading.md` is kept as a root hub because existing links referenced `[[Trading]]`.
- [[_EDITH_CRYPTO_EXPORT_TEST|E.D.I.T.H. Crypto Export Test]] looks like a QA/export smoke-test note, not durable knowledge. Review whether to tag as archived later.
- [[qa-runtime-crypto-note|QA Runtime Crypto Note]] looks like a QA/runtime note. Review whether to keep active, archive, or move into a QA area later.

## Large Generated Notes
- [[2026-09-02]] and [[2026-09-09]] are very large generated crypto daily notes. They were linked and tagged but not split, summarized, or moved.

## Previously Broken Hub Links Now Resolved
- [[Projects]]
- [[Tasks]]
- [[Research]]
- [[Conversations]]
- [[People]]
- [[Organizations]]
- [[Meetings]]

## Still Worth Reviewing
- Empty folders now have indexes but no content yet: Projects, Tasks, Research, Conversations, People, Organizations, Meetings, Memory.
- Trading symbol notes contain many repeated timeline observations. They are preserved as source history.
"@
Track-Upsert -Path (Join-Path $Root 'Needs Review.md') -Content $needsReview

$mdFiles = Get-ChildItem -LiteralPath $Root -Recurse -File -Filter '*.md'
foreach ($f in $mdFiles) {
    $path = $f.FullName
    $rel = $path.Substring($Root.Length).TrimStart('\')
    if ($rel -like 'Trading\Crypto Market Learning\Daily\*.md') {
        if (Add-FrontmatterIfMissing -Path $path -Type 'daily-note' -Tags @('edith','trading','crypto-learning','daily-note') -BelongsTo 'Crypto Market Learning Index') { $Modified.Add($path) }
    } elseif ($rel -like 'Trading\Crypto Market Learning\Symbols\*.md') {
        if (Add-FrontmatterIfMissing -Path $path -Type 'source' -Tags @('edith','trading','crypto-learning','source') -BelongsTo 'Crypto Market Learning Index') { $Modified.Add($path) }
    } elseif ($rel -eq 'Trading\Crypto Market Learning\_EDITH_CRYPTO_EXPORT_TEST.md') {
        if (Add-FrontmatterIfMissing -Path $path -Type 'source' -Tags @('edith','trading','crypto-learning','source','todo') -Status 'review-needed' -BelongsTo 'Crypto Market Learning Index') { $Modified.Add($path) }
    } elseif ($rel -eq 'Trading\Crypto Market Learning\qa-runtime-crypto-note.md') {
        $text = Read-Text $path
        $newText = $text -replace 'tags: \["edith/trading", "crypto-learning"\]', "tags:`n  - edith`n  - trading`n  - crypto-learning`n  - source"
        if ($newText -ne $text) {
            Write-Utf8NoBom -Path $path -Content $newText
            $Modified.Add($path)
        }
    }
}

$report = [pscustomobject]@{
    created = $Created
    modified = $Modified
}
$report | ConvertTo-Json -Depth 5
