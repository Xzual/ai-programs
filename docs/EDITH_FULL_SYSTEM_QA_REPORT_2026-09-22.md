# E.D.I.T.H. Full System QA Report

**Tarih:** 2026-09-22  
**Kapsam:** Gemini 3.6 Flash, provider/model yonlendirme, tum E.D.I.T.H. testleri, tarayici UI, Tauri, Crypto/Jev demo, Obsidian bilgi sistemi, guvenlik ve kaynak kod incelemesi  
**Dal:** `master`  
**Calisma agaci:** Kirli; 37 izlenen dosyada degisiklik ve cok sayida yeni/izlenmeyen dosya var. Bu rapor disinda urun kodu degistirilmedi.

## Yonetici Ozeti

**Genel karar: URETIM ICIN HAZIR DEGIL.**

Dal yerel gelistirmeye devam etmek icin kullanilabilir, fakat internete/LAN'a acik calistirma, release veya production kullanimi icin guvenli degil. En buyuk engeller:

1. Express `0.0.0.0:3000` uzerinde dinliyor ve API kimlik dogrulamasi yok. Izin politikasi, permission grant ve kill-switch kapatma endpointleri de korumasiz.
2. Kalici izin politikasi su anda `full_access`; `system:exec`, `file:write`, `browser:control`, `computer:control`, `iot:control` ve `trading:execute` varsayilan yetkili listede. Aktif emergency stop su an islemleri engelliyor, fakat onu kapatan endpoint de kimlik dogrulamasiz.
3. Gemini 3.6 Flash gercek isteklerde calisiyor, ancak provider health `pending/UNKNOWN` raporluyor. Auto router calisan Gemini yerine mock secip bunu fallback olarak da isaretlemiyor.
4. Ayarlar ekranindaki API key alani anahtari backend'e kaydetmiyor. Alan temizleniyor, ama UI aciklamasi yanlis bicimde anahtarin calisan backend oturumuna aktarildigini soyluyor.
5. `35` E.D.I.T.H. testinin `29`u gecti, `6`si kaldi. Cogunluk durum sozlesmesi/test drift'i; yine de kalite kapisi kirmizi.
6. Obsidian vault bagli, yazilabilir ve watcher aktif. Yazma/indeks olaylari basarili. Ancak bilgi grafigi/status endpointleri senkron ve agir calisarak Node event loop'u saniyelerce bloke ediyor.
7. Crypto Jev demo ve yeni UI testi gecti; gercek emir yolu kapali. Eski `test_modules.py` iki eski beklenti nedeniyle kaliyor.
8. Tauri Rust testleri, format kontrolu, release build, MSI ve NSIS paketleme gecti. Buna ragmen CSP kapali ve masaustu yetki yuzeyi gerektiginden genis.

## A. Calistirilan Komutlar

Ana kalite kapilari:

```powershell
npm run lint
npm run build
npm run smoke:gemini
npm run services:status
npm audit --omit=dev --json
git diff --check
```

Tum E.D.I.T.H. test matrisi:

```powershell
# package.json icindeki tum test:edith-* scriptleri tek tek calistirildi
npm run test:edith-persistence
npm run test:edith-registry
npm run test:edith-skills
npm run test:edith-intent
npm run test:edith-capabilities
npm run test:edith-agents
npm run test:edith-knowledge-map
npm run test:edith-kill-switch
npm run test:edith-mark-l
npm run test:edith-memory-v2
npm run test:edith-context-service
npm run test:edith-chat-context
npm run test:edith-model-router
npm run test:edith-permission-service
npm run test:edith-task-service
npm run test:edith-planner
npm run test:edith-executor
npm run test:edith-verifier
npm run test:edith-recovery
npm run test:edith-phase2-foundation
npm run test:edith-auth-persona
npm run test:edith-design3d-service
npm run test:edith-proactive-service
npm run test:edith-task-queue
npm run test:edith-legacy-tool-policy
npm run test:edith-local-tool-probes
npm run test:edith-sensitive-integrations
npm run test:edith-obsidian-knowledge
npm run test:edith-awesome-agent-skills
npm run test:edith-interaction-safety
npm run test:edith-computer-use
npm run test:edith-voice-room
npm run test:edith-providers
npm run test:edith-crypto
npm run test:edith-crypto-ui
```

Tauri/Rust:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run tauri:build
```

Python/Crypto/Mark-L:

```powershell
crypto\.venv\Scripts\python.exe -m compileall -q crypto Mark-L-main
crypto\.venv\Scripts\python.exe crypto\test_modules.py
```

Manuel ve API smoke testleri:

```text
POST /api/chat provider=gemini model=gemini-3.6-flash fallback=false
POST /api/chat provider=auto model=auto fallback=true
GET  /api/providers
GET  /api/providers/health
GET  /api/models
GET  /api/health
GET  /api/obsidian/status
GET  /api/knowledge/graph?limit=900
GET  /api/knowledge-graph/activity
GET  /api/knowledge-graph/live
GET  /api/edith/permissions/policy
GET  /api/edith/kill-switch
```

Ayrica 48 guvenli GET endpointi tarandi, 18 sol menu sekmesi tarayicida acildi, masaustu/mobil Crypto UI testi calistirildi, generated Tauri `edith.exe` 6 saniyelik baslatma smoke testinden gecirildi ve sonra kapatildi.

Kaynak taramalari:

```powershell
rg -n -i "aura" ...
rg -n "GEMINI_API_KEY|VITE_.*(KEY|TOKEN|SECRET)|process.env|import.meta.env" src ...
git grep -Il -E "AIza...|sk-...|ghp_...|PRIVATE KEY|GEMINI_API_KEY=..."
rg -n "TODO|FIXME|not implemented|not wired|FEATURE_DISABLED|UI shell only" ...
rg -n "eval\(|new Function|child_process|exec\(|spawn\(|Command::new" ...
rg -n "ENABLE_LIVE_TRADING|CRYPTO_LIVE_TRADING_ENABLED|BINANCE_TRADING_ENABLED" ...
```

## B. Sonuclar

| Kontrol | Sonuc | Ozet |
| --- | --- | --- |
| TypeScript lint | PASS | `tsc --noEmit`, hata yok |
| Web/server build | PASS | Vite ve `dist/server.cjs` olustu |
| E.D.I.T.H. test matrisi | FAIL | 29/35 gecti, 6 kaldi |
| Gemini gercek API | PASS | `gemini-3.6-flash`, HTTP 200, `GEMINI_OK` |
| E.D.I.T.H. Gemini chat | PASS | `EDITH_GEMINI_36_OK`, fallback yok, `completed` |
| Tarayici Gemini UI | PARTIAL | Gercek yanit geliyor; health/metadata `UNKNOWN` |
| Auto provider routing | FAIL | Calisan Gemini yerine `edith-mock` seciliyor |
| Provider/model listesi | PASS | Gemini 3.6 Flash, Gemini 2.5 Pro, Ollama ve mock listeleniyor |
| Ollama offline davranisi | PASS | Durum acikca offline; explicit no-fallback istegi `PROVIDER_UNAVAILABLE` |
| Mock/degraded mode | PASS | Ollama/Gemini kullanilamazken uygulama acik kaliyor |
| Tauri Rust testleri | PASS | 3/3 |
| Rust format | PASS | `cargo fmt --check` temiz |
| Tauri release build | PASS | `.exe`, `.msi`, NSIS setup uretildi |
| Tauri exe smoke | PASS | 6 saniye calisti, erken cokmedi |
| Crypto Jev demo testi | PASS | Demo portfoy, read-only market, karar-only akis |
| Crypto UI masaustu/mobil | PASS | Overflow yok, chart/terminal render oldu |
| Crypto legacy module testi | FAIL | 2 eski beklenti kaliyor |
| Obsidian baglanti | PASS/PERF RISK | Bagli, writable, watcher aktif; endpointler yavas |
| Browser konsolu | PASS | Hata/uyari yakalanmadi |
| NPM production audit | FAIL | 3 moderate vulnerability |
| Hardcoded Gemini key | PASS | Izlenen kaynakta gercek anahtar bulunmadi |
| Live trading default | PASS | Baslatma yollarinda kapali |
| Computer Use default | PASS | Read-only, owner onayi ve aktif session gerekli |
| `services:status` | FAIL | Calisan backend/provider/Obsidian'i timeout gosteriyor |

## C. Gecen Kontroller

### C1. Gemini 3.6 Flash

- `.env` bulundu ve ignore ediliyor. Gercek anahtar kaynak kodda degil, backend environment'tan okunuyor (`server/providers/gemini.ts:31-40`).
- `npm run smoke:gemini` gercek Google endpointine `gemini-3.6-flash` ile gitti ve HTTP `200`, `GEMINI_OK` aldi.
- E.D.I.T.H. SSE chat testi:
  - requested provider: `gemini`
  - requested model: `gemini-3.6-flash`
  - resolved provider/model: `gemini` / `gemini-3.6-flash`
  - response: `EDITH_GEMINI_36_OK`
  - fallback: `false`
  - final state: `completed`
- Tarayici UI testi JARVIS ile `UI_GEMINI_36_FRESH_OK` yanitini gercek modelden aldi.
- Daha once ayni UI state'inde ULTRON + Gemini ve JARVIS + Gemini ayri ayri yanit verdi. Assistant degisimi modeli, model degisimi assistant'i degistirmedi.
- Missing/placeholder key senaryolari `test:edith-providers` icinde gecti; uygulama key yokken cokmuyor.
- `/api/providers` ve `/api/models` Gemini 3.6 Flash'i dogru listeliyor.
- API payload taramasinda Google key kalibi bulunmadi. Provider status `secretExposed` benzeri alanlarda gizli deger dondurmuyor.
- Gemini key formuna girilen QA dummy degeri kaydetmeden sonra temizlendi. Kaynak incelemesi bu handler'in localStorage veya sessionStorage'a key yazmadigini gosteriyor.

### C2. Ollama ve fallback

- Ollama bu makinede offline. `/api/ollama/models` bunu `503/network_error` olarak acikca bildiriyor.
- Explicit Ollama + fallback istegi mock'a guvenli bicimde dusuyor.
- Explicit Ollama + fallback kapali istegi basarisizligi saklamiyor: `PROVIDER_UNAVAILABLE`.
- Mock modu gelistirme/degraded cevap uretmeye devam ediyor.

### C3. Crypto/Jev

- `test:edith-crypto` ve `test:edith-crypto-ui` gecti.
- Python servis smoke testinde:
  - public Binance OHLCV alindi;
  - 8 sembol listelendi;
  - Jev `jev-latest` yapilandirmasi secret gostermeden raporlandi;
  - demo HOLD islemi gercek emir acmadi;
  - `tradingEnabled=false`, `paperTradingEnabled=false`, `liveTradingEnabled=false`;
  - `realOrderSent=false`, `realMoneyUsed=false`.
- Baslatma kodlari canli ve paper trading bayraklarini zorla `false` yapiyor (`src/edith/cryptoService.ts:100-118`, `scripts/start-crypto-observer.mjs:21-26`).
- Yeni aktif ekran `CryptoExchangeTerminal`, servisi `/api/edith/crypto/start-service` ile baslatiyor ve Jev loop icin yeni `/api/crypto/jev/loop/start` yolunu kullaniyor.
- Masaustu ve mobil viewport'ta yatay overflow yok; chart ve terminal boyutlari sabit kaldi.

### C4. Obsidian

- `/api/obsidian/status`:
  - `connectionStatus=connected`
  - vault configured/found/readable/writable: `true`
  - watcher active: `true`
  - indexed notes: `79`
  - nodes: `284`
  - edges: `905`
  - chunks: `5000`
  - son 20 olayda hata: `0`
- Son olaylarda E.D.I.T.H. write ve Obsidian index islemleri `success`.
- `test:edith-obsidian-knowledge` gecti.
- Bu kanitlar **senkronizasyon/yazma/indeksleme** akisini dogrular. Ayri bir backup arsivi, snapshot veya versioned restore mekanizmasi dogrulanmadi; dolayisiyla "Obsidian yedegi var" denmemeli.

### C5. Desktop ve Computer Use

- Browser/dev modu `http://127.0.0.1:3000` uzerinde calisiyor.
- Tauri build iki installer uretmis durumda:
  - `src-tauri/target/release/bundle/msi/E.D.I.T.H._1.0.0_x64_en-US.msi`
  - `src-tauri/target/release/bundle/nsis/E.D.I.T.H._1.0.0_x64-setup.exe`
- Rust testleri su guvenlik sinirlarini dogruladi:
  - app launch yalnizca hardcoded safe allowlist;
  - tehlikeli key adlari allowlist disinda;
  - native action icin canli onay session'i gerekli ve stop session'i iptal ediyor.
- Native Computer Use varsayilan `read_only`; 5 dakikalik owner approval Windows MessageBox'u varsayilan `No` ile aciliyor (`src-tauri/src/computer.rs:193-229`).
- Hotkey 2-3 approved key ile sinirli ve ilk tus `Ctrl` veya `Shift` olmali (`src-tauri/src/computer.rs:525-547`).
- Uygulama baslatma allowlist'i yalnizca Notepad ve Calculator (`src-tauri/src/computer.rs:469-474`).
- Browser modunda native action kontrolleri disabled ve emergency stop gorunur.

## D. Basarisiz Kontroller

### D1. E.D.I.T.H. test matrisi: 6 fail

| Test | Actual | Expected | Degerlendirme |
| --- | --- | --- | --- |
| `test:edith-kill-switch` | `BLOCKED` | `PAUSED` | Uygulama kodu yeni `BLOCKED` semantigini kullaniyor; test eski |
| `test:edith-task-queue` | `BLOCKED` | `PAUSED` | Queue `resumable`, task status `BLOCKED`; tip/test sozlesmesi uyusmuyor |
| `test:edith-verifier` | `COMPLETED` | `VERIFYING` | Executor artik verifier'i kendi icinde calistirip tamamliyor; test eski |
| `test:edith-recovery` | task `VERIFYING` kaldi | `RETRYING` | Verifier `VERIFYING` statusunu verify edilebilir kabul etmiyor; gercek state-machine tutarsizligi |
| `test:edith-auth-persona` | source assertion false | true | Test kullanilmayan `ChatPanel.tsx` dosyasinin persona akisina katilmasini bekliyor; aktif ekran `ChatConsoleView` |
| `test:edith-mark-l` | tool result false | true | Test repo ana persistence'ini kullaniyor; aktif kill switch tarafindan bloklaniyor, izole degil |

Not: `PAUSED`, `RETRYING` ve `VERIFYING` halen `EdithTaskStatus` tipinde ve UI durum listesinde bulunuyor, fakat guncel implementasyon bunlari tutarli kullanmiyor. Bu sadece test isimlendirmesi degil, state-machine borcudur.

### D2. Crypto legacy module suite

`crypto/test_modules.py` iki hata ile kaldi:

1. Demo portfolio testi `initialBalance == 100.0` bekliyor; guncel guvenli demo config `10000.0` kullaniyor.
2. Dashboard testi `health["obsidian"]` bekliyor; bu fazda Crypto Obsidian entegrasyonu bilerek disabled ve health payload'inda bu alan yok.

Ayni suite icindeki market, teknik analiz, news, risk, paper engine ve observer-only kontrolleri gecti. Ollama offline iken karar motoru `NO TRADE` ile guvenli fallback yapti.

### D3. Services status

`npm run services:status`, calisan servisleri su sekilde yanlis raporladi:

```text
EDITH backend: timeout
Providers: timeout
Obsidian: timeout
Crypto service: offline
Crypto trading: unavailable
Ollama: offline
```

Ayni anda dogrudan istekler:

```text
/api/health                 200, ~113 ms
/api/providers/health       200, ~8 ms
/api/edith/obsidian/status  200, ~3163 ms
```

Kok neden: status scripti butun istekleri `Promise.all` ile baslatiyor ve her birine 2500 ms timeout koyuyor. Obsidian status cagrisi Node event loop'u senkron DB/graph islemleriyle 3 saniyeden uzun bloke ettigi icin diger health istekleri de timeout oluyor.

## E. TypeScript ve Build Problemleri

### Gecenler

- `npm run lint`: PASS.
- `npm run build`: PASS.
- `cargo fmt --check`: PASS.
- `cargo test`: PASS, 3/3.
- `npm run tauri:build`: PASS.
- Python `compileall`: PASS.
- `git diff --check`: whitespace hatasi yok; yalnizca CRLF donusum uyarilari.

### Uyarilar

1. Frontend ana chunk `631.95 kB` minified (`187.90 kB` gzip). Vite 500 kB warning'i veriyor.
2. `dist/server.cjs` yaklasik `529 kB`.
3. Tauri release build iki Rust uyarisi veriyor:
   - kullanilmayan `tauri::Manager` importu;
   - kullanilmayan `app` setup parametresi.
4. Dev logunda `src/components/ui/edithOS.tsx` icin Fast Refresh uyumsuz export uyarisi var: `statusCopy export is incompatible`.
5. Vite watcher `src-tauri/target` altindaki generated build dosyalarini gorup gereksiz page reload yapti. `vite.config.ts` watch ignore tanimlamiyor.
6. `tsconfig.json` `noUnusedLocals` acmiyor; `skipLibCheck=true`, `allowJs=true`. Bu nedenle dead importlar ve bazi library sorunlari lint tarafindan yakalanmiyor.
7. TypeScript kapsami `crypto`, `Mark-L-main` ve `knowledge map` klasorlerini disliyor. Bu alanlar icin ayri type/static gate yok.
8. `package.json` icindeki `clean` scripti `rm -rf dist`; Windows `cmd` ortaminda tasinabilir degil.

### Dead/duplicate kod

- `src/App.tsx` su eski view'lari import ediyor fakat aktif render agacinda kullanmiyor: `MemoryView`, `AutomationsView`, `SettingsView`, `EdithOpsView`, `KnowledgeMapView`, `Studio3DView`, `ProactiveView`, `CryptoView`.
- Aktif ekranlarin buyuk bolumu `src/components/ui/edithOS.tsx` icinde ikinci bir UI katmani olarak bulunuyor.
- `LegacyTradingScreen` ayni dosyada kalmis, fakat aktif `TradingScreen` yalnizca `CryptoExchangeTerminal` render ediyor.
- Bu durum test drift'ine, duplicate davranisa ve buyuk bundle'a katkida bulunuyor.

## F. Guvenlik Bulgulari

### F1. Kritik: korumasiz API + tum arayuzlere bind

- `server.ts:1711` sunucuyu `0.0.0.0` uzerinde dinliyor.
- Global auth, CSRF korumasi, Helmet veya rate limit yok (`server.ts:54-66`).
- Kimlik dogrulamasiz mutation endpointlerinden bazilari:
  - `PATCH /api/edith/permissions/policy`
  - `POST /api/edith/permissions/grants`
  - `POST /api/edith/kill-switch/deactivate`
  - task create/execute/recover
  - tool execute
  - Crypto servis/demo aksiyonlari
- UI login gercek kimlik dogrulama degil; iki sabit ada dayali localStorage session'i. Backend bunu yetkilendirme icin kullanmiyor.

### F2. Kritik: caller kendi permission listesini verebiliyor

Legacy tool endpointi `req.body.authorizedPermissions` degerini permission kararina iletiyor (`server.ts:978-986`). `permissionService.decideToolExecution` bunu varsayilan yetkiler yerine dogrudan kabul ediyor (`src/edith/permissionService.ts:192-208`).

Kill switch aktifken bu yol bloke, fakat korumasiz deactivate endpointi ile birlikte zincirlenirse `system:exec` veya `browser:control` gibi yetkiler caller tarafindan self-authorize edilebilir.

### F3. Yuksek: mevcut kalici policy `full_access`

Runtime policy:

```text
mode=full_access
highRiskEnabled=true
activeGrants=0
```

Yetkili listede `system:exec`, `file:write`, `browser:control`, `computer:control`, `iot:control`, `trading:execute` var. Emergency stop aktif oldugu icin mevcut durumda eylemler bloklu; bu tek basina yeterli bir auth boundary degil.

### F4. Yuksek: browser storage icinde diger secret tipleri

Gemini key formu localStorage'a yazmiyor. Ancak:

- `IntegrationConfig.apiKey` ve webhook URL'leri `edith_integrations_v1` altinda localStorage'a yaziliyor (`src/lib/storage.ts:771-793`).
- GitHub token benzeri degerler Integrations UI'dan bu alana girebiliyor (`src/components/views/IntegrationsView.tsx:73-85`, `187-195`).
- `UserSettings.claudeVoiceApiKey` tum settings objesiyle localStorage'a yaziliyor (`src/lib/storage.ts:649-666`).

Bu, UI'nin "frontend hassas key barindirmaz" guvenlik mesaji ile celisiyor.

### F5. Orta: Tauri sertlestirme

- CSP `null` (`src-tauri/tauri.conf.json:28-30`).
- `shell:allow-open` ve plugin `open: true` acik.
- `http:default` capability aktif.
- Native Computer Use iyi session/allowlist kontrollerine sahip, fakat webview XSS durumunda CSP olmamasi etki alanini buyutur.
- Desktop runtime report endpointi sabit `x-edith-desktop-runtime: tauri-v1` header'ina guveniyor. Bu header secret degil; ayni makinedeki baska process status/event spoof edebilir. HTTP action endpointi yine native input enjekte etmiyor, dolayisiyla bu bir status/audit butunlugu riski.

### F6. Orta: dependency audit

`npm audit --omit=dev`:

- 3 moderate;
- 0 high;
- 0 critical.

Etkilenen zincir: direct `express` ve transitive `body-parser` uzerinden `qs 6.15.3`. Array-limit bypass ve DoS advisory'leri var; fix mevcut.

### F7. Mark-L secret modeli

- E.D.I.T.H. Gemini provider environment-only.
- Mark-L legacy kodu bircok yerde `Mark-L-main/config/api_keys.json` bekliyor ve eski Gemini 2.5 Flash adlarini kullaniyor.
- Bu dosya su an mevcut degil ve repoda izlenmiyor; gercek secret sizintisi bulunmadi.
- Mark-L adapter default disabled ve permission/kill-switch katmanindan geciyor, fakat legacy projenin secret modeli ana E.D.I.T.H. standardiyla uyumlu degil.

## G. Kalan AURA / E.D.I.T.H. Isim Sorunlari

Aktif UI, `README.md` ve `metadata.json` E.D.I.T.H. olarak temiz.

Kalan `AURA` referanslari:

- `.gitignore`: `.aura_monitors.json` legacy migration/ignore kaydi.
- `src/lib/storage.ts`: eski localStorage key'lerini migration icin parcalayarak olusturan legacy prefix.
- `EDITH_ARCHITECTURE_REPORT.md` ve `PROJECT_FULL_REPORT.md`: tarihsel mimari metinlerinde eski urun adi.
- `ParticleCore` ve eski `KnowledgeMapView` icindeki `aura` degiskenleri gorsel efekt terimi; marka kimligi degil.

User-facing aktif ekranda AURA kimligi gorulmedi. Tarihsel dokumanlar arsiv olarak isaretlenmeli veya guncellenmeli.

Ek dokuman celiskileri:

- README, Gemini Settings key formunun anahtari kaydetmedigini dogru soyluyor; Settings ekranindaki ust aciklama kaydedildigini iddia ediyor.
- README Computer Use adapterinin bagli olmadigini soyluyor; guncel Tauri Rust native bridge mevcut. Browser modunda read-only olmasi ayri bir durum.
- README Crypto'yu genel olarak observer-only tanimliyor; aktif ekran artik Jev kararli yerel demo exchange.

## H. Repoda Olmamasi Gereken Runtime Dosyalari

Izlenen kaynaklar icinde `.venv`, `data`, `logs`, `dist`, `target` veya coverage klasoru bulunmadi. Ignore kurallari calisiyor.

Yerel ama ignore edilen buyuk runtime alanlari:

| Yol | Dosya | Yaklasik boyut |
| --- | ---: | ---: |
| `src-tauri/target` | 12,510 | 11,365.81 MB |
| `crypto/.venv` | 14,175 | 421.68 MB |
| `crypto/data` | 3 | 96.38 MB |
| `.edith` | 36 | 69.08 MB |
| `logs` | 29 | 13.80 MB |
| `crypto/logs` | 4 | 7.30 MB |
| `dist` | 4 | 0.83 MB |
| `data` | 3 | 0.58 MB |

Ozel notlar:

- `crypto/data/agent_memory.db` yaklasik 90 MB.
- `crypto/logs/edith-autostart.log` yaklasik 7.4 MB. Log rotation yoksa buyumeye devam eder.
- Tauri `target` klasoru yerel diskte 11 GB ustunde; source problemi degil, disk temizligi konusu.

Izlenen ama source niteliginde supheli alan:

- `edith-promo-landing/ai programs tester`: 121 tracked dosya, yaklasik 10.74 MB.
- HTTrack cache listeleri/zipleri, ucuncu taraf JS mirror'lari, MP4 ve MP3 iceriyor.
- Bu klasor bilincli bir offline fixture degilse repodan cikarilmali veya artifact storage'a alinmali.

## I. Regresyon Riskleri

### I1. Gemini health ve auto routing

`server/providers/gemini.ts:226-238`, key varsa network dogrulamasi yapmadan bilincli olarak:

```text
available=false
healthy=false
status=pending
```

donduruyor. Manual Gemini istegi route icindeki ozel bypass ile calisiyor, fakat auto router `pending` Gemini'yi secmiyor. Sonuc:

- gercek Gemini calisiyor;
- Settings/Header `UNKNOWN` diyor;
- auto mode `edith-mock` seciyor;
- mock secimi `fallbackUsed=false` ve `providerStatus=available` raporluyor; gercek degrade/fallback durumu gizleniyor.

### I2. Gemini key UI sahte islem

`src/components/ui/edithOS.tsx:3749-3767`:

- girilen key'i state'ten siliyor;
- hicbir backend endpointi cagirmiyor;
- warning ile env'i elle ayarlamayi soyluyor.

Ayni ekranda `3857-3860` ise "Kaydet" sonrasi calisan backend env'ine ayarlanacagini soyluyor. Bu kullaniciya calismayan bir ozelligi calisiyormus gibi gosteriyor.

### I3. Knowledge Graph event-loop bloklama

`obsidianVaultService.status()` her cagrida `knowledgeGraphService.snapshot({limit:5000})` cagiriyor. Snapshot ise her okumada `ingestEdithRuntime()` calistirip cok sayida SQLite upsert yapiyor.

Olculen sureler:

| Endpoint | Sure | Payload |
| --- | ---: | ---: |
| `/api/knowledge/graph?limit=900` | ~3.0 s | ~376.8 KB |
| `/api/edith/obsidian/status` | ~3.2 s | ~5.5 KB |
| `/api/knowledge-graph/activity` | ~3.1 s | ~112 KB |
| `/api/knowledge-graph/live` | ~6.0 s | ~480.4 KB |
| `/api/knowledge-graph/stats` | ~5.9 s | ~0.8 KB |

React dev StrictMode cagrilari iki kez baslatabiliyor. `KnowledgeGraphScreen` uc endpointi `Promise.all` ile bekliyor ve tek hata durumunda node/edge listelerini sifirliyor (`src/components/ui/edithOS.tsx:1138-1156`). Bu nedenle ekranda ilk 10-20 saniye yanlis bicimde "veri yok" gorulebiliyor.

### I4. Voice status stale UI

Backend `/api/voice/live/status` su anda:

- configured/available: true;
- runtime: offline;
- connector bound: true;
- secret exposed: false;

UI ise ayni ekranda hem `backend connector bound` hem de eski `Gemini Live voice connector is not wired yet` metnini gosteriyor. `jarvisReply` ilk fallback mesaji ile initialize ediliyor ve status fetch sonrasi guncellenmiyor (`src/components/ui/edithOS.tsx:1556-1608`). Mikrofon/gercek live session testi browser permission gerektirdigi icin bu turda baslatilmadi.

### I5. Crypto legacy contract

- Yeni aktif Crypto terminali dogru `start-service` yolunu kullaniyor.
- Eski `/api/edith/crypto/start` endpointi halen legacy `/api/crypto/start-observer` yoluna gidiyor.
- Python bu endpointi bilerek `409 LEGACY_OBSERVER_DISABLED` ile reddediyor (`crypto/src/dashboard.py:943-945`).
- Express wrapper inner status hata dondurse bile HTTP `200 success:true` dondurebiliyor (`server/routes/crypto.ts:72-77`, `src/edith/cryptoService.ts:146-160`).

Eski caller veya dokuman bu endpointi kullanirsa "baslatildi" cevabi alip runtime'i `STOPPED` gorebilir.

### I6. Fonksiyonel olmayan veya shell-only ekranlar

Tarayicida 18 sekme acildi. Guncel durum:

| Ekran | Durum |
| --- | --- |
| Command Center | Canli ozet, ancak task engine yerine agirlikla UI state/log ozetliyor |
| Chat | Calisiyor; Gemini ve mock dogrulandi |
| Agents | Statik/turetilmis kartlar, agent baslatma kontrolu yok |
| Tasks | Durum modeli ve UI timeline; kalici backend task listesiyle tam CRUD bagli degil |
| Computer Use | Tauri'de izinli native bridge; browser'da dogru bicimde read-only/blocked |
| Browser | Read-only safety/registry ozeti; aktif browser agent oturumu yok |
| Memory | Local memory kayitlarini gosteriyor |
| Knowledge Graph | Gercek veri, ancak ciddi gecikme/loading problemi |
| Automations | Tetikleyici tipleri ve registry ozeti; canli scheduler yonetimi yok |
| Files | Empty-state shell; dosya oturumu/artefact browser bagli degil |
| Coding | Chat tabanli kod yardimi mevcut; sistem exec kill-switch/permission ile bloklu |
| Crypto | Yeni demo exchange calisiyor; live trading yok |
| Tools/MCP | Gercek skill/tool registry; yukleme gecikmesi var |
| Voice | Backend Live connector var; UI status stale, mic session smoke yapilmadi |
| Integrations | Config UI var; gercek connector capability'leri sinirli, secret localStorage riski var |
| Security | Policy/safety durumunu gosteriyor; backend auth olmadigi icin guvenlik siniri degil |
| System | Diagnostics var; bazi satirlar gercek probe yerine proxy metrik |
| Settings | Provider/model/persona calisiyor; API key save calismiyor |

### I7. Yaniltici diagnostics

`SystemHealthScreen`:

- Database'i sadece backend online ise `ONLINE` sayiyor; gercek DB probe yok.
- Tool Registry'yi listede en az bir arac varsa `ONLINE` sayiyor; tool health degil.
- Tauri package build'i Cargo mevcutsa `ONLINE` sayiyor; son build sonucunu okumuyor.

Boot screen genel olarak backend endpointlerine dayaniyor ve sahte gecikme animasyonu uretmiyor; bu olumlu. Ancak yukaridaki diagnostics etiketleri daha dar ve dogru adlandirilmali.

### I8. Kirli ve buyuk degisiklik seti

- 37 tracked dosyada yaklasik 1,993 ekleme / 743 silme var.
- Yeni Crypto, Computer Use ve skill registry dosyalari untracked.
- QA icin clean commit/merge-base olmadigindan hangi takim degisikliginin hangi regresyonu getirdigini kesin ayirmak zor.
- Tek bir `npm test`/CI aggregator yok; testlerin unutulma riski yuksek.

## J. Onerilen Son Duzeltmeler

Oncelik sirasiyla:

1. **API guvenlik siniri:** Dev varsayilan bind adresini `127.0.0.1` yap. Auth/session + CSRF ekle. Permission policy/grant, kill-switch deactivate, tool/task/crypto mutation endpointlerini owner-auth olmadan calistirma.
2. **Permission bypass'i kapat:** `authorizedPermissions` degerini request body'den guvenme. Yalnizca server-side policy ve sureli, kayitli grantlerden hesapla.
3. **Persisted policy'yi guvenliye cek:** Varsayilan ve migration hedefi `ask` veya `deny` olmali. `full_access` yalnizca acik owner onayi ve sureli session ile etkinlesmeli.
4. **Gemini health'i gercek yap:** Kisa timeoutlu, cache'li model/list veya minimal generate probe kullan. Basarili manual call sonrasi cache'i `available` yap. Auto router Gemini'yi kullanabilsin.
5. **Auto fallback metadata:** Mock'a dususte `fallbackUsed=true`, `providerStatus=degraded/fallback` ve gercek aday hatasi raporlanmali.
6. **Key UI kararini netlestir:** Ya backend-only, memory-only ve auth korumali bir session key endpointi uygula ya da input/Kaydet butonunu kaldir. Mevcut yanlis "env'e kaydedildi" metnini hemen duzelt.
7. **Task state machine:** `PAUSED/BLOCKED`, `VERIFYING/COMPLETED`, `RETRYING/BLOCKED` sozlesmesini tek standarda indir; implementation, tipler, UI ve 5 ilgili testi ayni anda guncelle.
8. **Test izolasyonu:** Mark-L testi temp persistence kullanmali ve kill-switch state'ini fixture ile kurmali. Testler repo ana `.edith` verisine baglanmamali.
9. **Crypto test drift:** 10000 demo bakiye ve disabled Crypto Obsidian sozlesmesine gore `test_modules.py` guncellenmeli. Legacy observer endpointleri kaldirilmali veya dogru 409/`success:false` proxy edilmeli.
10. **Obsidian performansi:** Read endpointlerinde `ingestEdithRuntime()` ile DB write yapma. Snapshot/status cache'i, incremental refresh ve worker/background index kullan. UI'da loading/error ayir ve `Promise.allSettled` ile kismi veriyi koru.
11. **Voice UI state:** Status fetch sonrasi `jarvisReply/statusMessage` senkronize edilmeli; `offline but configured` ile `not wired` ayri durumlar olmali.
12. **Tauri hardening:** CSP tanimla, HTTP origin scope'unu daralt, gerekli degilse shell open'i kaldir. Runtime report/event icin yerel ephemeral token veya Tauri command channel kullan.
13. **Secret storage:** Integration tokenlari ve voice key'lerini localStorage'dan backend secret store/OS keychain'e tasi. UI'ye mevcut key'i geri dondurme.
14. **Dependency update:** `express/body-parser/qs` advisory fix'lerini al ve audit gate ekle.
15. **Dev performansi:** `src-tauri/target`, `crypto/.venv`, `logs`, `data` icin Vite watch ignore ekle. `services:status` timeout ve senkron bloklama sorununu duzelt.
16. **Dead kod/bundle:** Aktif olmayan view importlarini kaldir veya lazy-load et; `edithOS.tsx` ekranlarini bol; `noUnusedLocals` ac.
17. **Repo temizligi:** HTTrack mirror/cache klasorunu bilincli fixture degilse Git'ten cikar. Runtime DB/log rotation ve yerel cleanup dokumani ekle.
18. **CI:** Tek komutla lint, build, 35 E.D.I.T.H. testi, Rust test/fmt, Python compile/tests ve audit calistiran fail-fast olmayan bir QA scripti ekle.

## Son Karar

**Dal, yalnizca yerel gelistirmeye devam etmek icin kosullu olarak guvenli.** Devam ederken emergency stop aktif kalmali ve port 3000 yerel agdan erisilebilir olmamali.

**Dal production-ready degil.** Release oncesi en az F1-F4, Gemini health/auto routing, 6 kirmizi test, Crypto legacy testleri ve Obsidian event-loop bloklama giderilmeli; ardindan tum matris sifir hata ile yeniden kosulmali.
