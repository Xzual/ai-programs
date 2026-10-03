# Project storage cleanup — 2026-10-02

Scope: entire `ai programs` workspace; remove reproducible generated storage without changing the project.

## Verified result

- Removed logical file lengths: 43,993,535,334 bytes (40.973 GiB). Hardlinked Cargo artifacts mean logical lengths overcount physical disk use.
- Measured increase in C: free space during deletion: **36,243,042,304 bytes (33.75 GiB / 36.24 GB)**. Other disk activity can affect this measurement.
- SHA-256 before/after verification: **56,743 retained files unchanged**, including source, configuration, untracked reports, runtime binaries/resources and packaged outputs. Git history, installed dependencies and virtual environments were excluded from hashing and left untouched.
- Tracked Git working-tree status unchanged; zero failed deletions; all planned targets absent. No app or compiler process was running in deletion targets.

## Deleted

- EDITH and Minik bot Rust debug/release `.fingerprint`, `build`, `deps`, `incremental`, `examples`.
- Generated profile-root `.pdb`, `.rlib`, `.lib`, `.exp`, `.d` files.
- Android project `.gradle` / `.kotlin` caches and app build `generated`, `intermediates`, `kotlin`, `kotlinToolingMetadata`, `tmp`.
- Python source-tree bytecode/test/type-checker caches. Packaged/staged runtime bytecode was deliberately retained to preserve release manifests.

## Retained

All source, secrets/config, data/databases/backups, reports/screenshots, Git history, node_modules and Python virtual environments. EDITH debug/release EXE/backend/runtime resources; Minik bot EXE/DLL/hook; registry-linked release `zen-download-host.exe` and manifest; release installers/portable payloads/ZIPs; Android APKs, mapping, reports and test results; vetted `.edith-build` Python staging.

Remaining target sizes: EDITH 1,597,197,943 bytes; Minik bot 23,556,637 bytes; Android app/build 99,703,021 bytes. These are retained runnable outputs/resources, not compile caches.

Deleted caches were permanently removed rather than moved to Recycle Bin. Cargo builds, Gradle builds and Python imports recreate them; the next compilation will take longer. No rebuild was performed solely to recreate the deleted storage, and no claim of new runtime feature testing is made.

Audit used the requested create-subagent skill; a separate read-only storage auditor checked ownership/runtime dependencies before deletion. `scripts/cleanup-generated-storage.ps1` defaults to dry-run; `-Apply` validates containment, rejects reparse targets/tracked content/live build processes and verifies retained-file hashes.

Final independent audit: PASS — selected cache paths absent; preserved binaries, runtime directories, registry linkage, APKs, reports and source manifests present. Both package manifests and both Tauri configurations parsed successfully. Minik bot TypeScript `tsc --noEmit` passed without regenerating build caches. Verification establishes filesystem preservation; applications were not launched or recompiled.
