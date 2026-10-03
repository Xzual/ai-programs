# E.D.I.T.H. Chat 7 Crypto/Jev Paket Kanıtı - 2026-09-27

## Sonuç

Bu çalışma `C:\Users\arday\Desktop\ai programs` yetkili kökünde doğrulandı. Crypto servisi public Binance verisi, 10.000 kredilik izole demo ledger ve Jev BUY/SELL/HOLD karar sözleşmesiyle çalışıyor. Gerçek Binance emir yolu yoktur; live, paper, Obsidian, learning, news ve Ollama bu fazda kapalıdır.

Bu rapor üretim hazır iddiası değildir. İmzalı/kurulmuş son masaüstü paketinin uçtan uca release kabulü Chat 6/release sahibinde kalır.

## Güvenlik Kanıtı

- Flask yalnızca `127.0.0.1` üzerinde dinler.
- Python mutasyonları süreç başına üretilen `X-EDITH-Internal-Token` olmadan `403` döndürür.
- Token Node belleğinde tutulur, yalnızca child env'e verilir, tarayıcıya/status/log yanıtına aktarılmaz, restartta döner ve stopta temizlenir.
- Express üzerindeki bütün crypto POST yolları `requireProtectedMutation` ile owner session + exact same-origin + CSRF ister.
- Tarayıcının gönderdiği sahte internal token Python'a forward edilmez.
- GET status/portfolio/market uçları local-loopback ürün modeli için owner auth olmadan okunabilir kalmıştır. Secret redaction vardır; yine de çok kullanıcılı veya LAN'a açılan bir dağıtım öncesinde read auth ayrıca değerlendirilmelidir.
- `CRYPTO_STARTING_BALANCE` üretim yolunda tam `10000` olmak zorundadır. Farklı aktif ledger temizlenmeden arşivlenir ve yeni 10.000 ledger açılır.
- HOLD, geçersiz karar ve `executed:true` iddiası taşıyan güvenilmez provider yanıtları trade üretmez. Risk motoru kararı veto edebilir.
- Binance istemcisi public market data kullanır; private order/withdraw/transfer endpointi yoktur.

## Paket Runtime Kanıtı

- Paket girişi: `.edith-build/desktop/resources/crypto/run_agent.py`
- Paket Python: `.edith-build/desktop/resources/python/python.exe` (`Python 3.12.13`)
- Sidecar: `src-tauri/binaries/edith-backend-x86_64-pc-windows-msvc.exe`
- Tauri resource mapping halihazırda `crypto/` ve `python/` dizinlerini içerir.
- `crypto/requirements.lock.txt` 16 doğrudan paketi exact version ile kilitler.
- Import closure ve `pip check` geçti.
- Packaged mod PATH/`py` fallback kullanmaz; `resource_missing`, `runtime_missing`, `dependency_missing` ve `service_unavailable` ayrı raporlanır.
- Packaged kaynak allowlist'i yalnızca entrypoint, lock/requirements, `src`, `templates` ve güvenli config dosyalarını taşır. `.venv`, data, logs, DB, backup, screenshot, cache, test ve secret-like içerik paketlenmez.
- Kanıt: `artifacts/crypto-terminal/packaged-staged-runtime.json`.

## Legacy İzolasyonu ve Geri Alma

- Bilinen sahte dataset tam fingerprint: `39e0898a9c93605e27aa1bc9f5cc54bc88222df9520d0fc12ed9ebc730305523`.
- Yalnızca bu tam fingerprint eşleştiği için izolasyon uygulandı; geniş bakiye aralığı tek başına silme yetkisi değildir.
- Arşiv: `crypto/data/legacy-quarantine/agent_memory.legacy-39e0898a9c93605e.sqlite3`.
- Arşiv SHA-256: `c33475a3fef2c28d306728c42e8d6bfbb8043bad83c9d30d52eba2b9de58a667`.
- Arşivlenen satırlar: `portfolio_state=1055`, `trades=640`, `decisions=7657`.
- SQLite `integrity_check=ok`; ana DB legacy tabloları `0/0/0`.
- Aktif v2 demo session korunmuştur: başlangıç `10000`, işlem geçmişi `7` kayıt.
- Geri alma yordamı `restore_legacy_quarantine(db_path, archive_path)`; non-empty hedefe merge etmeyi ve checksum uyuşmazlığını reddeder.

## Jev Güncel Durum ve Tarihçe

- Sağlık TTL sonrası eski başarılı temas `ready` olarak gösterilmez; güncel sağlık `ready/stale/not_configured/error` şeklinde dürüst raporlanır.
- `lastProviderContact` tarihsel telemetridir ve güncel availability yerine kullanılmaz.
- Gerçek recovery testinde mevcut Jev sağlayıcısı doğrulandı: model `jev-1.13.0`, karar `HOLD`, latency `509 ms`, `executed=false`, trade yok.
- UI viewport koşusunda sağlayıcı sağlık bilgisi `unverified` idi ve arayüz bunu `JEV HAZIR` diye göstermedi. Bu, tarihsel HOLD kararının güncel readiness kanıtı sayılmadığını doğrular.

## Test/Gate Tablosu

| Gate | Sonuç | Kanıt |
|---|---|---|
| `npm run test:edith-crypto` | PASS | Jev demo BUY/SELL/HOLD, replay ve live lock |
| `npm run test:edith-crypto-hardening` | PASS | 16 ledger + 3 API + 36 market/Jev reliability testi |
| `npm run test:edith-crypto-ui` | PASS | 390/768/1366/1440/1920/2560, chart nonblank, sıfır crypto write |
| `node scripts/test-edith-crypto-real-recovery.mjs` | PASS | gerçek Binance, lost BUY recovery, replay, HOLD, SELL, gerçek Jev HOLD |
| `crypto\.venv\Scripts\python.exe crypto\test_runtime_reliability.py` | PASS | process restart replay, 10.000 kredi, kullanıcı hesabı untouched |
| `crypto/test_service_security.py` | PASS | loopback token, evil origin, token rotation, exact 10.000 invariant |
| `crypto/test_legacy_isolation.py` | PASS | exact fingerprint, candidate approval, archive/restore |
| `crypto/test_jev_runtime_safety.py` | PASS | TTL, invalid/HOLD no-execution, secret redaction |
| `node scripts/test-edith-crypto-route-security.mjs` | PASS | session/origin/CSRF ve browser token spoof sınırı |
| `node scripts/test-edith-crypto-runtime-lock.mjs` | PASS | 16 exact pin + import closure |
| `node scripts/test-edith-crypto-resource-staging.mjs` | PASS | runtime state/secret/test exclusion |
| `node scripts/test-edith-crypto-packaged-runtime.mjs` | PASS | unrelated CWD, managed start, protected mutation, state separation |
| `node scripts/test-edith-crypto-staged-runtime.mjs` | PASS | bundled Python + entrypoint + 10.000 kredi + no real orders |
| `npm run lint` | PASS | `tsc --noEmit` |
| `npm run build` | PASS | Vite + Express bundle; yalnızca chunk-size uyarısı |
| `git diff --check` (crypto scope) | PASS | whitespace hatası yok |

## Değişiklik Alanları

- Python runtime/safety: `crypto/run_agent.py`, `crypto/src/config.py`, `crypto/src/dashboard.py`, `crypto/src/demo_migration.py`, `crypto/src/demo_portfolio.py`, `crypto/src/asset_modes.py`, `crypto/src/jev_adapter.py`, `crypto/src/jev_loop.py`.
- Node proxy/runtime: `server/routes/crypto.ts`, `src/edith/cryptoService.ts`.
- Paket/runtime araçları: crypto staging, Python resolver/runner, packaged/staged runtime, route-security, recovery ve UI test scriptleri.
- Lock/tests: `crypto/requirements.lock.txt`, import-closure, service-security, legacy-isolation, Jev-runtime ve reliability testleri.

## Engeller ve Handoff

### INTERNAL_PENDING

- Son imzalı installer/portable arşiv üzerinde tam release smoke bu Chat 7 kapsamında çalıştırılmadı. Chat 6, aynı `.edith-build/desktop/resources/{crypto,python}` girdileriyle son paketi üretip installer içinden start/stop testini tekrar çalıştırmalı.
- GET crypto portfolio/status uçları local-loopback modelinde açık. Ürün ileride LAN veya çok kullanıcılı hale gelirse owner read-auth eklenmeli.

### EXTERNAL_BLOCKER

- Jev provider availability dış servise bağlıdır. Bu koşuda gerçek HOLD doğrulandı; sonraki çalıştırmalarda yalnızca güncel health başarılıysa `ready` kabul edilmelidir.
- Binance public API erişimi ağ/ülke/provider durumuna bağlıdır; erişilemezse UI fake fiyat göstermeden degraded/offline kalır.

## Çalıştırma

- Geliştirme: `npm run dev`
- Crypto servis: `node scripts/start-crypto-observer.mjs`
- Servis: `http://127.0.0.1:5000`
- Health: `GET http://127.0.0.1:5000/api/health`
- Varsayılan mod: `OBSERVER_ONLY`; demo ledger açık, paper/live kapalıdır.
