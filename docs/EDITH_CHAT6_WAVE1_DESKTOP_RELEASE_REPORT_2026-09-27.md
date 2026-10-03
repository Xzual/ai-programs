# E.D.I.T.H. Chat 6 Wave 1 Desktop Release Report

Tarih: 27 Eylul 2026

## A. Yetkili calisma alani

- Root: `C:\Users\arday\Desktop\ai programs`
- Branch: `master`
- Baslangic HEAD: `77b194ca58cf4741cfd499cc4c457de24492e35c`
- Tur sirasinda dis bir islem HEAD'i `51af863a2b15311a88ac015936bbb0a2c65677dd` commit'ine ilerletti.
- Bu gorev commit, push, merge, rebase veya tag yapmadi; ilgisiz kullanici/ajan degisikliklerini geri almadi.

## B. Uygulanan masaustu degisiklikleri

- Tauri sidecar durumu atomik port/status/generation/restart/shutdown alanlariyla guclendirildi.
- Tek instance eklendi; ikinci acilis mevcut ana pencereyi gosterip odakliyor.
- Sidecar restart sayisi 3 ve backoff degerleri 500/1500/3500 ms ile sinirli.
- Uygulama ici close ve Windows normal close ayni koordineli shutdown yoluna baglandi.
- Release WebView, sidecar health basarili olduktan sonra loopback backend'e yonlendiriliyor.
- Null CSP kaldirildi; frontend'e broad shell/http/fs/process/global-shortcut/clipboard yetkisi verilmedi.
- Capability yalniz ana pencere, loopback URL, directory picker ve iki salt-okunur pencere geometri izniyle sinirli.
- Her sidecar nesli icin OS CSPRNG ile 256-bit, tek kullanimli owner bootstrap token uretiliyor; storage/log/response'a yazilmiyor ve restart/shutdown'da temizleniyor.
- `tauri:build`, Rust kaynaklarindaki yerel workspace/UserProfile yollarini release binary'den remap eden wrapper'a baglandi.

## C. Paket ve portable guvenligi

- Crypto kaynaklari artik tek strict allowlist sahneleyicisinden geciyor: `run_agent.py`, requirements dosyalari, `src/*.py`, `templates/*.html`, `config/*.json`.
- `data`, `logs`, legacy/backup/test/screenshot/docs/secret benzeri dosyalar ve allowlist disi uzantilar build ile portable kopyasinda dislaniyor.
- Staging hedefi her kosuda temizleniyor; source/destination overlap ve hedef containment denetleniyor.
- Gercek `crypto/` uretim girdisi testinde 33 izinli dosya ve 0 yasakli dosya bulundu.
- Python bundle exact lock ve `pip check` sonrasinda sahneleniyor; pycache/pyc alinmiyor ve `EDITH_RUNTIME_VERIFIED.json` bu build'de yeniden uretiliyor.
- Portable dizin, ZIP, manifest ve SHA-256 uretiliyor. ZIP entry'leri absolute/drive/UNC, `..`, ADS, duplicate/case-collision ve link/reparse sinirlarinda extraction oncesi kontrol ediliyor.
- PowerShell Archive modulune bagimlilik kaldirildi; ZIP create/extract `System.IO.Compression` ile yapiliyor.
- Portable verifier 11.437 dosyanin boyut/hash manifestini hem kaynak dizinde hem ZIP'ten cikartilan kopyada dogruladi.

## D. Guvenlik modeli

- Computer Use: `READ_ONLY`; gercek fare/klavye eylemi etkinlestirilmedi.
- Browser Use: `READ_ONLY`; browser automation etkinlestirilmedi.
- Screenshot/OCR, wake word, global OS shortcut, tray/background mode ve gercek device control etkin degil.
- Kill switch, owner session, CSRF ve backend hazirligi yoksa eylemler fail-closed kalir.
- Crypto gercek emir davranisi etkinlestirilmedi; paketlenen runtime observer/demo sinirinda tutuldu.
- Kullanici tarafinda API key veya owner bootstrap secret saklanmiyor.

## E. Komutlar ve sonuclar

- `npm run tauri:build`: PASS; taze EXE, MSI ve NSIS uretildi.
- `npm run desktop:portable`: PASS; 11.437 dosya, ZIP SHA-256 `ef51307498a8b40bb7b155009e431df49c550330ea9a11560584e16b32abb2c8`.
- `npm run desktop:portable:verify`: PASS.
- `npm run smoke:edith-desktop-release`: 17 PASS, 0 FAIL, 4 EXTERNAL_BLOCKER. Exit code yalniz unsigned artefaktlar nedeniyle non-zero.
- Runtime smoke: visible launch, managed sidecar, kontrollu sidecar crash/restart, single-instance ve normal close/no-orphan PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS; yalniz Vite 500 kB chunk uyarisi.
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS, 5/5.
- `npm run test:edith-computer-use`: PASS.
- `npm run test:edith-interaction-safety`: PASS.
- `npm run test:edith-kill-switch`: PASS.
- `npm run test:edith-voice-room`: PASS (kontrat/fallback testleri; fiziksel mikrofon/Gemini Live kaniti degil).
- `npm run test:edith-desktop-python-lock`: PASS.
- `node scripts/test-edith-crypto-runtime-lock.mjs`: PASS; 16 exact pin ve import closure.
- `node scripts/test-edith-crypto-resource-staging.mjs`: PASS; gercek kaynakta 33 izinli, 0 yasakli dosya.
- `npm run test:edith-portable-security`: PASS; 5/5 zararli ZIP reddedildi.

## F. Taze artefaktlar

| Artefakt | Boyut | SHA-256 | Imza |
|---|---:|---|---|
| `src-tauri/target/release/edith.exe` | 16.039.936 | `1691d719c823c2a86e98470eae8fa755d15cd120f8aa39d7d6771f6e1fadd10b` | NotSigned |
| `src-tauri/target/release/edith-backend.exe` | 50.353.551 | `7c38d12fc78dad4302a6f6b98eec83396045c8baf124606c1c5119560911d9dd` | NotSigned |
| `src-tauri/target/release/bundle/msi/E.D.I.T.H._1.0.0_x64_en-US.msi` | 148.902.748 | `d3a6abdb7c6ebc294166f9260c3b7e97f425641af2cce26c2ffd7951ef685d81` | NotSigned |
| `src-tauri/target/release/bundle/nsis/E.D.I.T.H._1.0.0_x64-setup.exe` | 99.359.521 | `397a5764073e54e82972adca5194784a62e2a5e0e5c151a9d2e0456f68c493a1` | NotSigned |
| `artifacts/desktop/E.D.I.T.H.-1.0.0-windows-x64.zip` | 151.036.325 | `ef51307498a8b40bb7b155009e431df49c550330ea9a11560584e16b32abb2c8` | N/A |

## G. Gate karari

| Gate | Sonuc | Kanit |
|---|---|---|
| Packaged Tauri bridge | PASS | Taze packaged app launch + sidecar health/runtime |
| In-app/OS close | PASS | Normal close sonrasi gozlenen app descendant yok |
| Single-instance | PASS | Ikinci process cikti, ilk instance calismaya devam etti |
| Bounded sidecar supervision | PASS | Kontrollu crash sonrasi yeni child PID; statik max 3/backoff kontrolu |
| Honest Computer Use readiness | PASS | Read-only/fail-closed testleri; gercek kontrol acilmadi |
| CSP/capabilities | PASS | Null CSP yok, broad frontend primitive yok |
| Portable completeness/security | PASS (bu makine) | Manifest/hash/extract ve malicious ZIP testleri PASS |
| Crypto release lock/staging | PASS | 16 exact pin, import closure, strict allowlist 33/0 |
| Fresh EXE/MSI/NSIS | PASS (build) | Uc Tauri artefakti taze ve hash'lendi |
| MSI/NSIS install-uninstall | EXTERNAL_BLOCKER | Temiz VM kurulum/kaldirma turu bu oturumda yapilmadi |
| Ikinci makine portable smoke | EXTERNAL_BLOCKER | Temiz makine kaniti gerekli |
| Authenticode | EXTERNAL_BLOCKER | EXE, sidecar, MSI ve NSIS `NotSigned`; production sertifikasi yok |
| Fiziksel Voice/Gemini Live | EXTERNAL_BLOCKER | Gercek mic/speaker/provider kabul turu yok |

Nihai karar: **PARTIAL / RELEASE BLOCKED**. Internal smoke hatasi yoktur; Authenticode ve temiz-makine kabul kaniti olmadan production-ready iddiasi yapilmaz.

## H. Kalan handofflar

1. Signing owner: production Authenticode sertifikasi ile EXE, sidecar, MSI ve NSIS'i imzalayip dogrulamali.
2. Release operator: temiz Windows VM'de MSI ve NSIS install/launch/upgrade-uninstall turunu yapmali.
3. Release operator: portable ZIP'i ikinci temiz makinede Unicode ve bosluk iceren dizinden launch/close/reopen ile test etmeli.
4. Voice ekibi: packaged runtime'da fiziksel mikrofon/hoparlor ve gercek Gemini Live kabul turunu provider/hardware hazirken yapmali.
5. Tamamlanan cross-team entegrasyon: Chat 2 ortak memory-only `ownerMutationFetch` akisini bagladi; Chat 4 Computer Use runtime/events/stop ile workspace/knowledge backend mutation yollarinda owner-session + origin + CSRF enforcement'ini tamamladi. Ilgili testler PASS; storage tabanli secret kullanilmiyor.

## I. Degisen release dosyalari

`package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `scripts/build-edith-sidecar.mjs`, `scripts/build-edith-tauri.mjs`, `scripts/desktop-python-lock.mjs`, `scripts/portable-edith-lib.mjs`, `scripts/stage-edith-crypto-resources.mjs`, `scripts/package-edith-portable.mjs`, `scripts/verify-edith-portable.mjs`, `scripts/test-edith-crypto-resource-staging.mjs`, `scripts/test-edith-desktop-python-lock.mjs`, `scripts/test-edith-portable-security.mjs`, `scripts/test-edith-desktop-release.mjs`, `scripts/test-edith-computer-use.ts`, `src/edith/desktopShell.ts`, `src/components/layout/DesktopTitleBar.tsx` ve bu rapor.
