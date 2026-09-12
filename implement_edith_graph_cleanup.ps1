$ErrorActionPreference = 'Stop'

$IWithDot = [char]0x0130
$Root = "D:\ED${IWithDot}TH\ED${IWithDot}TH"
$Today = '2026-09-12'
$Created = New-Object System.Collections.Generic.List[string]
$Modified = New-Object System.Collections.Generic.List[string]

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

function Upsert-Note {
    param([string]$Path, [string]$Content)
    $exists = Test-Path -LiteralPath $Path
    if ($exists -and ((Read-Text $Path) -eq $Content)) { return }
    Write-Utf8NoBom -Path $Path -Content $Content
    if ($exists) { $Modified.Add($Path) } else { $Created.Add($Path) }
}

function Has-Frontmatter {
    param([string]$Text)
    return $Text.StartsWith("---`r`n") -or $Text.StartsWith("---`n")
}

function Strip-Frontmatter {
    param([string]$Text)
    if (-not (Has-Frontmatter $Text)) { return $Text }
    $m = [regex]::Match($Text, '(?s)^---\r?\n.*?\r?\n---\r?\n?')
    if ($m.Success) { return $Text.Substring($m.Length) }
    return $Text
}

function Add-Or-Replace-Frontmatter {
    param([string]$Path, [string]$Frontmatter)
    $text = Read-Text $Path
    $body = Strip-Frontmatter $text
    $newText = $Frontmatter.TrimEnd() + "`r`n---`r`n`r`n" + $body.TrimStart()
    if ($newText -ne $text) {
        Write-Utf8NoBom -Path $Path -Content $newText
        $Modified.Add($Path)
    }
}

function Ensure-After-Heading {
    param([string]$Path, [string]$Block)
    $text = Read-Text $Path
    if ($text.Contains($Block.Trim())) { return }
    $lines = $text -split "\r?\n", -1
    $insertAt = 0
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^# ') { $insertAt = $i + 1; break }
    }
    $before = @()
    $after = @()
    if ($insertAt -gt 0) { $before = $lines[0..($insertAt-1)] }
    if ($insertAt -lt $lines.Count) { $after = $lines[$insertAt..($lines.Count-1)] }
    $newLines = @($before) + @('', $Block.Trim(), '') + $after
    $newText = ($newLines -join "`r`n").TrimEnd() + "`r`n"
    if ($newText -ne $text) {
        Write-Utf8NoBom -Path $Path -Content $newText
        $Modified.Add($Path)
    }
}

function Frontmatter {
    param(
        [string]$Type,
        [string]$Status = 'active',
        [string[]]$Tags,
        [string[]]$Links = @(),
        [string[]]$Related = @(),
        [string]$CreatedDate = '',
        [string]$UpdatedDate = '2026-09-12'
    )
    $createdLine = if ($CreatedDate) { "created: $CreatedDate" } else { 'created:' }
    $tagBlock = ($Tags | ForEach-Object { "  - $_" }) -join "`r`n"
    $linkBlock = if ($Links.Count) { ($Links | ForEach-Object { "  - `"$($_)`"" }) -join "`r`n" } else { '' }
    $relatedBlock = if ($Related.Count) { ($Related | ForEach-Object { "  - `"$($_)`"" }) -join "`r`n" } else { '' }
    return @"
---
type: $Type
source: edith
origin: obsidian
status: $Status
$createdLine
updated: $UpdatedDate
tags:
$tagBlock
links:
$linkBlock
related:
$relatedBlock
"@
}

function Get-NoteListForFolder {
    param([string]$FolderName, [string]$IndexName)
    $folder = Join-Path $Root $FolderName
    if (-not (Test-Path -LiteralPath $folder)) { return '- No notes yet.' }
    $notes = Get-ChildItem -LiteralPath $folder -File -Filter '*.md' | Where-Object { $_.BaseName -ne $IndexName } | Sort-Object BaseName
    if (-not $notes) { return '- No notes yet.' }
    return (($notes | ForEach-Object { "- [[$($_.BaseName)]]" }) -join "`r`n")
}

$mainIndex = @"
$(Frontmatter -Type 'index' -Tags @('edith','index','knowledge-map','source') -Links @('[[Memory Index]]','[[Projects Index]]','[[Tasks Index]]','[[Research Index]]','[[Trading Index]]','[[Conversations Index]]','[[People Index]]','[[Organizations Index]]','[[Meetings Index]]','[[Crypto Market Learning Index]]','[[Needs Review]]','[[E.D.I.T.H. Note Writing Rules]]'))
---

# E.D.I.T.H. Index

This is the central hub for E.D.I.T.H.'s Obsidian external brain and graph map.

## Core Vault Areas
- [[Memory Index]]
- [[Projects Index]]
- [[Tasks Index]]
- [[Research Index]]
- [[Trading Index]]
- [[Conversations Index]]
- [[People Index]]
- [[Organizations Index]]
- [[Meetings Index]]

## E.D.I.T.H. System
- [[Knowledge Map]]
- [[Obsidian]]
- [[Agents]]
- [[Tools]]
- [[Model Router]]
- [[Browser Agent]]
- [[Crypto Observer]]
- [[Voice System]]
- [[Security System]]
- [[E.D.I.T.H. Note Writing Rules]]

## Active Work
- [[Crypto Market Learning Index]]
- [[Daily Crypto Index]]
- [[Symbols Index]]

## Needs Review
- [[Needs Review]]

## Operating Rules
- Preserve existing notes and links.
- Add parent links and standardized tags so Graph View remains connected.
- Put unclear, duplicate-looking, or sensitive-looking items in [[Needs Review]] instead of deleting them.
- Keep secrets out of notes. Redact API keys, tokens, passwords, and private keys only with explicit approval.
"@
Upsert-Note -Path (Join-Path $Root 'E.D.I.T.H. Index.md') -Content $mainIndex

$folderMeta = @(
    @{Name='Memory'; Tag='memory'; Purpose='Stable memories, preferences, facts, and reusable long-term context for E.D.I.T.H.'; Related=@('[[Projects Index]]','[[Conversations Index]]','[[Knowledge Map]]')},
    @{Name='Projects'; Tag='project'; Purpose='Active and archived project workstreams connected to tasks, research, and decisions.'; Related=@('[[Tasks Index]]','[[Research Index]]','[[Memory Index]]')},
    @{Name='Tasks'; Tag='task'; Purpose='Action items, todo notes, decisions, and follow-ups that E.D.I.T.H. should track.'; Related=@('[[Projects Index]]','[[Meetings Index]]','[[Needs Review]]')},
    @{Name='Research'; Tag='research'; Purpose='Research notes, sources, findings, and browser research connected to projects and systems.'; Related=@('[[Projects Index]]','[[Trading Index]]','[[Browser Agent]]')},
    @{Name='Trading'; Tag='trading'; Purpose='Trading research and observer-only crypto market learning. This area must not contain live trading instructions.'; Related=@('[[Research Index]]','[[Tasks Index]]','[[Crypto Market Learning Index]]')},
    @{Name='Conversations'; Tag='conversation'; Purpose='Conversation records and summaries linked to memories, projects, tasks, and decisions.'; Related=@('[[Memory Index]]','[[Projects Index]]','[[Tasks Index]]')},
    @{Name='People'; Tag='person'; Purpose='People profiles, relationship context, and human contacts relevant to E.D.I.T.H.'; Related=@('[[Organizations Index]]','[[Meetings Index]]','[[Conversations Index]]')},
    @{Name='Organizations'; Tag='organization'; Purpose='Organization profiles, external entities, sources, and institutional context.'; Related=@('[[People Index]]','[[Research Index]]','[[Meetings Index]]')},
    @{Name='Meetings'; Tag='meeting'; Purpose='Meeting notes, summaries, decisions, and action items.'; Related=@('[[Tasks Index]]','[[People Index]]','[[Organizations Index]]')}
)

foreach ($m in $folderMeta) {
    $idx = "$($m.Name) Index"
    $notesList = Get-NoteListForFolder -FolderName $m.Name -IndexName $idx
    $related = ($m.Related | ForEach-Object { "- $_" }) -join "`r`n"
    $extra = ''
    if ($m.Name -eq 'Trading') {
        $extra = @"

## Crypto Learning
- [[Crypto Market Learning Index]]
- [[Daily Crypto Index]]
- [[Symbols Index]]
- [[Risk Management]]
- [[Market Sentiment]]
"@
    }
    $content = @"
$(Frontmatter -Type 'index' -Tags @('edith','index',$m.Tag,'knowledge-map') -Links @('[[E.D.I.T.H. Index]]') -Related $m.Related)
---

# $idx

> Source: E.D.I.T.H.
> Type: index
> Status: active

## Connected To
- [[E.D.I.T.H. Index]]
$related

## Purpose
$($m.Purpose)

## Notes
$notesList$extra

## Needs Review
- [[Needs Review]]
"@
    Upsert-Note -Path (Join-Path $Root "$($m.Name)\$idx.md") -Content $content
}

foreach ($m in $folderMeta) {
    $hubPath = Join-Path $Root "$($m.Name).md"
    if (Test-Path -LiteralPath $hubPath) {
        $idx = "$($m.Name) Index"
        $content = @"
$(Frontmatter -Type 'moc' -Tags @('edith',$m.Tag,'index') -Links @("[[$idx]]",'[[E.D.I.T.H. Index]]'))
---

# $($m.Name)

Compatibility hub for [[$idx]]. This root note is preserved so existing Obsidian links do not break.

## Index
- [[$idx]]
- [[E.D.I.T.H. Index]]
"@
        if ($m.Name -eq 'Memory') {
            $content += @"

## Daily Memory Sources
- [[2026-09-09]]
- [[2026-09-05]]
- [[2026-09-03]]
- [[2026-09-02]]
- [[2026-09-11]]
- [[2026-09-12]]
"@
        }
        if ($m.Name -eq 'Trading') {
            $content += @"

## Crypto
- [[Crypto Market Learning Index]]
- [[Daily Crypto Index]]
- [[Symbols Index]]
- [[BTC-USDT]]
- [[ETH-USDT]]
- [[SOL-USDT]]
- [[BNB-USDT]]
- [[XRP-USDT]]
- [[DOGE-USDT]]
- [[AVAX-USDT]]
- [[ADA-USDT]]
"@
        }
        Upsert-Note -Path $hubPath -Content ($content.TrimEnd() + "`r`n")
    }
}

$concepts = @(
    @{Name='Knowledge Map'; Type='system'; Tags=@('edith','system','knowledge-map','obsidian'); Summary='Explains how E.D.I.T.H. uses indexes, backlinks, tags, and review notes to keep the vault navigable.'; Links=@('[[E.D.I.T.H. Index]]','[[Obsidian]]','[[E.D.I.T.H. Note Writing Rules]]','[[Needs Review]]')},
    @{Name='Obsidian'; Type='tool'; Tags=@('edith','tool','obsidian','knowledge-map'); Summary='The local Markdown vault and graph interface used as E.D.I.T.H.''s external brain.'; Links=@('[[E.D.I.T.H. Index]]','[[Knowledge Map]]','[[E.D.I.T.H. Note Writing Rules]]')},
    @{Name='Agents'; Type='system'; Tags=@('edith','agent','system'); Summary='Agent capabilities, workflows, and responsibilities used by E.D.I.T.H.'; Links=@('[[E.D.I.T.H. Index]]','[[Tools]]','[[Model Router]]')},
    @{Name='Tools'; Type='system'; Tags=@('edith','tool','system'); Summary='Tools and integrations E.D.I.T.H. can use, with links to related agents and systems.'; Links=@('[[E.D.I.T.H. Index]]','[[Agents]]','[[Browser Agent]]')},
    @{Name='Model Router'; Type='system'; Tags=@('edith','system'); Summary='System concept for selecting or routing model capabilities for E.D.I.T.H. workflows.'; Links=@('[[E.D.I.T.H. Index]]','[[Agents]]','[[Tools]]')},
    @{Name='Browser Agent'; Type='agent'; Tags=@('edith','agent','browser-research'); Summary='Agent concept for browser research, source gathering, and web-based investigation.'; Links=@('[[E.D.I.T.H. Index]]','[[Research Index]]','[[Tools]]')},
    @{Name='Crypto Observer'; Type='system'; Tags=@('edith','system','trading','crypto-learning'); Summary='Observer-only crypto market learning system. It records analysis and lessons without live trading instructions.'; Links=@('[[E.D.I.T.H. Index]]','[[Trading Index]]','[[Crypto Market Learning Index]]')},
    @{Name='Voice System'; Type='system'; Tags=@('edith','system'); Summary='Voice-related system concept for E.D.I.T.H. interaction design and audio workflows.'; Links=@('[[E.D.I.T.H. Index]]','[[Agents]]','[[Tools]]')},
    @{Name='Security System'; Type='system'; Tags=@('edith','system'); Summary='Security rules for secrets, credentials, safe note writing, and sensitive review handling.'; Links=@('[[E.D.I.T.H. Index]]','[[Needs Review]]','[[E.D.I.T.H. Note Writing Rules]]')},
    @{Name='Risk Management'; Type='concept'; Tags=@('edith','concept','trading','crypto-learning'); Summary='Concept note for risk awareness in observer-only crypto learning. This is not financial advice.'; Links=@('[[Trading Index]]','[[Crypto Market Learning Index]]','[[Volatility]]','[[Market Sentiment]]')},
    @{Name='Volatility'; Type='concept'; Tags=@('edith','concept','trading','crypto-learning'); Summary='Concept note for tracking market volatility language and lessons across crypto notes.'; Links=@('[[Trading Index]]','[[Crypto Market Learning Index]]','[[Risk Management]]','[[Trend]]')},
    @{Name='Trend'; Type='concept'; Tags=@('edith','concept','trading','crypto-learning'); Summary='Concept note for market trend observations in crypto learning notes.'; Links=@('[[Trading Index]]','[[Crypto Market Learning Index]]','[[Volatility]]','[[Market Sentiment]]')},
    @{Name='Market Sentiment'; Type='concept'; Tags=@('edith','concept','trading','crypto-learning'); Summary='Concept note for news, mood, uncertainty, and market context observed in crypto learning.'; Links=@('[[Trading Index]]','[[Crypto Market Learning Index]]','[[Risk Management]]','[[Trend]]')}
)

foreach ($c in $concepts) {
    $linkLines = ($c.Links | ForEach-Object { "- $_" }) -join "`r`n"
    $content = @"
$(Frontmatter -Type $c.Type -Tags $c.Tags -Links $c.Links)
---

# $($c.Name)

> Source: E.D.I.T.H.
> Type: $($c.Type)
> Status: active

## Connected To
$linkLines

## Summary
$($c.Summary)

## Details
This note exists to make the E.D.I.T.H. Knowledge Map easier to navigate and to connect related notes in Obsidian Graph View.

## Related Notes
$linkLines
"@
    Upsert-Note -Path (Join-Path $Root "$($c.Name).md") -Content $content
}

$rules = @"
$(Frontmatter -Type 'system' -Tags @('edith','system','obsidian','knowledge-map') -Links @('[[E.D.I.T.H. Index]]','[[Knowledge Map]]','[[Obsidian]]','[[Needs Review]]'))
---

# E.D.I.T.H. Note Writing Rules

Whenever E.D.I.T.H. creates a new note, it must:

1. Put it in the correct folder.
2. Add frontmatter.
3. Add a parent index link.
4. Add at least one meaningful wikilink.
5. Add standardized tags.
6. Add source, origin, and status.
7. Avoid secrets.
8. Avoid isolated notes.
9. Update the relevant index when safe.
10. Add unclear notes to [[Needs Review]].

## Connected To
- [[E.D.I.T.H. Index]]
- [[Knowledge Map]]
- [[Obsidian]]
- [[Security System]]
"@
Upsert-Note -Path (Join-Path $Root 'E.D.I.T.H. Note Writing Rules.md') -Content $rules

$dailyNotes = Get-ChildItem -LiteralPath (Join-Path $Root 'Trading\Crypto Market Learning\Daily') -File -Filter '*.md' | Where-Object { $_.BaseName -match '^\d{4}-\d{2}-\d{2}$' } | Sort-Object BaseName
$symbolNotes = Get-ChildItem -LiteralPath (Join-Path $Root 'Trading\Crypto Market Learning\Symbols') -File -Filter '*.md' | Sort-Object BaseName
$dailyLinks = ($dailyNotes | ForEach-Object { "- [[$($_.BaseName)]]" }) -join "`r`n"
$symbolLinks = ($symbolNotes | ForEach-Object { "- [[$($_.BaseName)]]" }) -join "`r`n"

$dailyIndex = @"
$(Frontmatter -Type 'index' -Tags @('edith','index','trading','crypto-learning','crypto-daily') -Links @('[[Crypto Market Learning Index]]','[[Trading Index]]'))
---

# Daily Crypto Index

> Source: E.D.I.T.H.
> Type: index
> Status: active

## Connected To
- [[Crypto Market Learning Index]]
- [[Trading Index]]
- [[Symbols Index]]

## Daily Notes
$dailyLinks

## Safety
- Mode: OBSERVER_ONLY
- Live Trading: Locked
- Paper Trading: Disabled
- Not financial advice
"@
Upsert-Note -Path (Join-Path $Root 'Trading\Crypto Market Learning\Daily\Daily Crypto Index.md') -Content $dailyIndex

$symbolsIndex = @"
$(Frontmatter -Type 'index' -Tags @('edith','index','trading','crypto-learning','crypto-symbol') -Links @('[[Crypto Market Learning Index]]','[[Trading Index]]'))
---

# Symbols Index

> Source: E.D.I.T.H.
> Type: index
> Status: active

## Connected To
- [[Crypto Market Learning Index]]
- [[Trading Index]]
- [[Daily Crypto Index]]
- [[Risk Management]]
- [[Volatility]]
- [[Trend]]
- [[Market Sentiment]]

## Symbols
$symbolLinks

## Safety
- Mode: OBSERVER_ONLY
- Live Trading: Locked
- Paper Trading: Disabled
- Not financial advice
"@
Upsert-Note -Path (Join-Path $Root 'Trading\Crypto Market Learning\Symbols\Symbols Index.md') -Content $symbolsIndex

$cryptoIndex = @"
$(Frontmatter -Type 'index' -Tags @('edith','index','trading','crypto-learning','knowledge-map') -Links @('[[Trading Index]]','[[Daily Crypto Index]]','[[Symbols Index]]'))
---

# Crypto Market Learning Index

> Source: E.D.I.T.H.
> Type: index
> Status: active

Observer-only crypto learning map for E.D.I.T.H. This area is for learning and analysis, not financial advice or live trading instructions.

## Connected To
- [[E.D.I.T.H. Index]]
- [[Trading Index]]
- [[Daily Crypto Index]]
- [[Symbols Index]]
- [[Crypto Observer]]
- [[Risk Management]]
- [[Volatility]]
- [[Trend]]
- [[Market Sentiment]]

## Daily Notes
$dailyLinks

## Symbols
$symbolLinks

## Supporting Notes
- [[qa-runtime-crypto-note]]
- [[_EDITH_CRYPTO_EXPORT_TEST]]

## Safety
- Mode: OBSERVER_ONLY
- Live Trading: Locked
- Paper Trading: Disabled
- Not financial advice
"@
Upsert-Note -Path (Join-Path $Root 'Trading\Crypto Market Learning\Crypto Market Learning Index.md') -Content $cryptoIndex

foreach ($d in $dailyNotes) {
    $date = $d.BaseName
    $links = @('[[Crypto Market Learning Index]]','[[Daily Crypto Index]]','[[Trading Index]]')
    foreach ($s in $symbolNotes) {
        $sym = $s.BaseName
        $text = Read-Text $d.FullName
        $slash = $sym -replace '-', '/'
        if ($text -match [regex]::Escape($sym) -or $text -match [regex]::Escape($slash)) {
            $links += "[[$sym]]"
        }
    }
    if ($links.Count -le 3) {
        foreach ($s in $symbolNotes) { $links += "[[$($s.BaseName)]]" }
    }
    $fm = Frontmatter -Type 'crypto_daily' -Tags @('edith','trading','crypto-learning','crypto-daily') -Links $links -Related @('[[Risk Management]]','[[Volatility]]','[[Trend]]','[[Market Sentiment]]') -CreatedDate $date -UpdatedDate $Today
    Add-Or-Replace-Frontmatter -Path $d.FullName -Frontmatter $fm
    $block = @"
## Connected To
- [[Crypto Market Learning Index]]
- [[Daily Crypto Index]]
- [[Trading Index]]
$((($links | Where-Object { $_ -match '-USDT' }) | Sort-Object -Unique | ForEach-Object { "- $_" }) -join "`r`n")

## Safety
- Mode: OBSERVER_ONLY
- Live Trading: Locked
- Paper Trading: Disabled
- Not financial advice
"@
    Ensure-After-Heading -Path $d.FullName -Block $block
}

foreach ($s in $symbolNotes) {
    $fm = Frontmatter -Type 'crypto_symbol' -Tags @('edith','trading','crypto-learning','crypto-symbol') -Links @('[[Crypto Market Learning Index]]','[[Symbols Index]]','[[Trading Index]]','[[Risk Management]]','[[Volatility]]','[[Trend]]','[[Market Sentiment]]') -Related @('[[Daily Crypto Index]]') -CreatedDate ((Get-Item -LiteralPath $s.FullName).CreationTime.ToString('yyyy-MM-dd')) -UpdatedDate $Today
    Add-Or-Replace-Frontmatter -Path $s.FullName -Frontmatter $fm
    $block = @"
## Connected To
- [[Crypto Market Learning Index]]
- [[Symbols Index]]
- [[Trading Index]]
- [[Risk Management]]
- [[Volatility]]
- [[Trend]]
- [[Market Sentiment]]

## Safety
- Mode: OBSERVER_ONLY
- Live Trading: Locked
- Paper Trading: Disabled
- Not financial advice
"@
    Ensure-After-Heading -Path $s.FullName -Block $block
}

$qaPath = Join-Path $Root 'Trading\Crypto Market Learning\qa-runtime-crypto-note.md'
if (Test-Path -LiteralPath $qaPath) {
    $block = @"
## Connected To
- [[Crypto Market Learning Index]]
- [[Trading Index]]
- [[Needs Review]]
"@
    Ensure-After-Heading -Path $qaPath -Block $block
}

$needsReview = @"
$(Frontmatter -Type 'review' -Tags @('edith','todo','needs-review','knowledge-map') -Links @('[[E.D.I.T.H. Index]]','[[Knowledge Map]]'))
---

# Needs Review

Nothing was deleted. This note lists items that need human review before any rename, merge, archive, or cleanup.

## Audit Summary
- Vault path preserved: ``$Root``
- No files deleted.
- No folders renamed.
- No permanent moves performed.
- Strict credential-pattern scan found no likely secrets before this cleanup.

## Root Notes Kept For Link Compatibility
- [[Memory]] and [[Memory Index]] both exist. `Memory.md` is kept as a compatibility hub.
- [[Trading]] and [[Trading Index]] both exist. `Trading.md` is kept as a compatibility hub.
- [[Projects]], [[Tasks]], [[Research]], [[Conversations]], [[People]], [[Organizations]], and [[Meetings]] are kept as compatibility hubs.

## Duplicate-Looking Or Unclear Notes
- [[_EDITH_CRYPTO_EXPORT_TEST|E.D.I.T.H. Crypto Export Test]] looks like a QA/export smoke-test note, not durable knowledge.
- [[qa-runtime-crypto-note|QA Runtime Crypto Note]] looks like a QA/runtime note. Review whether to keep active, archive, or move into a QA area later.
- `Başlıksız.base` is an Obsidian Bases file with a table view. It was not converted, renamed, moved, or deleted.

## Large Generated Notes
- [[2026-09-02]], [[2026-09-09]], [[2026-09-11]], and [[2026-09-12]] are large generated crypto daily notes. They were linked and tagged, not split or summarized.

## External Manual Cleanup Candidate
- `D:\EDÄ°TH` exists outside the approved vault path and appears to be an accidental duplicate path from a prior encoding issue. It was not touched because this cleanup is limited to `D:\EDİTH\EDİTH` and must not delete anything.

## Still Worth Reviewing
- Empty or light folders now have indexes but little content: Projects, Tasks, Research, Conversations, People, Organizations, Meetings, Memory.
- Trading symbol notes contain many repeated timeline observations. They are preserved as source history.
"@
Upsert-Note -Path (Join-Path $Root 'Needs Review.md') -Content $needsReview

$result = [pscustomobject]@{
    created = $Created
    modified = $Modified
}
$result | ConvertTo-Json -Depth 5
