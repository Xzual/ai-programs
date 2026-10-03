param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$cleanupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cleanupPrefix = $cleanupRoot + [IO.Path]::DirectorySeparatorChar
$cleanupTargets = [Collections.Generic.List[string]]::new()
$cleanupProfiles = @('src-tauri\target\debug','src-tauri\target\release','minik bot\windows\target\debug','minik bot\windows\target\release')
foreach ($profile in $cleanupProfiles) {
    foreach ($cache in @('.fingerprint','build','deps','incremental','examples')) {
        $candidate = Join-Path $cleanupRoot (Join-Path $profile $cache)
        if (Test-Path -LiteralPath $candidate) { $cleanupTargets.Add($candidate) }
    }
    $profilePath = Join-Path $cleanupRoot $profile
    if (Test-Path -LiteralPath $profilePath) {
        foreach ($file in Get-ChildItem -LiteralPath $profilePath -File -Force) {
            if ($file.Extension -in @('.pdb','.rlib','.lib','.exp','.d')) { $cleanupTargets.Add($file.FullName) }
        }
    }
}
foreach ($relative in @('mobile\app\build\intermediates','mobile\app\build\generated','mobile\app\build\kotlin','mobile\app\build\kotlinToolingMetadata','mobile\app\build\tmp','mobile\.gradle','mobile\.kotlin')) {
    $candidate = Join-Path $cleanupRoot $relative
    if (Test-Path -LiteralPath $candidate) { $cleanupTargets.Add($candidate) }
}
function Get-SafeTree([string]$path) {
    $stack = [Collections.Generic.Stack[string]]::new()
    $stack.Push($path)
    while ($stack.Count) {
        $entry = Get-Item -LiteralPath $stack.Pop() -Force
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point rejected: $($entry.FullName)" }
        $entry
        if ($entry.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $entry.FullName -Force) { $stack.Push($child.FullName) }
        }
    }
}
# Python bytecode only, never virtual environments or installed dependencies.
$stack = [Collections.Generic.Stack[string]]::new()
$stack.Push($cleanupRoot)
while ($stack.Count) {
    foreach ($dir in Get-ChildItem -LiteralPath $stack.Pop() -Directory -Force) {
        if (($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if ($dir.Name -in @('.git','node_modules','.venv','venv','env','ENV','target','.gradle','artifacts','.edith-build','output')) { continue }
        if ($dir.Name -in @('__pycache__','.pytest_cache','.mypy_cache','.ruff_cache')) { $cleanupTargets.Add($dir.FullName) } else { $stack.Push($dir.FullName) }
    }
}
$cleanupTargets = @($cleanupTargets | Sort-Object -Unique)
$tracked = @(& git -C $cleanupRoot ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify Git tracking' }
$beforeStatus = @(& git -C $cleanupRoot status --porcelain=v1 -uno)
$plan = foreach ($target in $cleanupTargets) {
    $resolved = (Resolve-Path -LiteralPath $target).ProviderPath
    if (-not $resolved.StartsWith($cleanupPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw "Outside project: $resolved" }
    $relative = $resolved.Substring($cleanupPrefix.Length).Replace('\','/')
    if ($tracked.Where({ $_ -eq $relative -or $_.StartsWith($relative + '/', [StringComparison]::OrdinalIgnoreCase) }).Count) { throw "Tracked cleanup target: $relative" }
    $entries = @(Get-SafeTree $resolved)
    [pscustomobject]@{Path=$resolved;Bytes=[long](($entries | Where-Object {-not $_.PSIsContainer} | Measure-Object Length -Sum).Sum);Files=@($entries | Where-Object {-not $_.PSIsContainer}).Count}
}
$plan | Select-Object Path,Bytes,Files | ConvertTo-Json -Depth 3
if (-not $Apply) { return }
# Refuse to race live app/build processes; leave runtime binaries/resources intact.
$processes = @(Get-CimInstance Win32_Process)
foreach ($process in $processes) {
    if ($process.Name -match '^(cargo|rustc|gradle|java|coucou|edith|edith-backend|zen-download-host)\.exe$') { throw "Close app/build process before cleanup: $($process.Name) PID $($process.ProcessId)" }
    foreach ($target in $cleanupTargets) {
        if ($process.ExecutablePath -and ($process.ExecutablePath -eq $target -or $process.ExecutablePath.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase))) { throw "Live process in cleanup target: $target" }
    }
}
function Get-ProtectedHashes {
    $hashes = @{}
    $scan = [Collections.Generic.Stack[string]]::new()
    $scan.Push($cleanupRoot)
    while ($scan.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $scan.Pop() -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            if ($item.PSIsContainer) {
                if ($item.Name -in @('.git','node_modules','.venv','venv','env','ENV')) { continue }
                if ($cleanupTargets -contains $item.FullName) { continue }
                $scan.Push($item.FullName)
            } elseif ($cleanupTargets -notcontains $item.FullName) {
                $hashes[$item.FullName] = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
            }
        }
    }
    return ,$hashes
}
$protected = Get-ProtectedHashes
$diskBefore = (Get-PSDrive -Name ([IO.Path]::GetPathRoot($cleanupRoot).TrimEnd(':\'))).Free
$failures = @()
foreach ($row in $plan) {
    # Revalidate exact resolved target and descendants immediately before deletion.
    $resolved = (Resolve-Path -LiteralPath $row.Path).ProviderPath
    if ($resolved -ne $row.Path -or -not $resolved.StartsWith($cleanupPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Target changed' }
    $null = @(Get-SafeTree $resolved)
    try { Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop } catch { $failures += "$resolved : $($_.Exception.Message)" }
}
$changed = @()
foreach ($path in $protected.Keys) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $protected[$path]) { $changed += $path }
}
$afterStatus = @(& git -C $cleanupRoot status --porcelain=v1 -uno)
$statusChanged = @(Compare-Object $beforeStatus $afterStatus).Count
$remaining = @($cleanupTargets | Where-Object {Test-Path -LiteralPath $_})
$diskAfter = (Get-PSDrive -Name ([IO.Path]::GetPathRoot($cleanupRoot).TrimEnd(':\'))).Free
[pscustomobject]@{LogicalRemovedBytes=($plan | Measure-Object Bytes -Sum).Sum;DiskFreeDeltaBytes=$diskAfter-$diskBefore;ProtectedFiles=$protected.Count;ChangedProtectedFiles=$changed;TrackedStatusChanges=$statusChanged;RemainingTargets=$remaining;Failures=$failures} | ConvertTo-Json -Depth 4
if ($changed.Count -or $statusChanged -or $remaining.Count -or $failures.Count) { throw 'Cleanup verification did not pass completely' }
