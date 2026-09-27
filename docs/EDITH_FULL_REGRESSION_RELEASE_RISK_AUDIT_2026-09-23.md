# E.D.I.T.H. Full Regression / Release-Risk Audit

**Tarih:** 2026-09-23  
**Dal:** `master` (`77b194c`)  
**Kapsam:** Gemini text, Gemini Live Voice Room, Computer Use/Tauri, Skill Registry, Obsidian, Crypto Demo Exchange/Jev, güvenlik, UI odağı ve release taşınabilirliği  
**Yöntem:** Read-mostly kaynak incelemesi, statik kontroller, izole testler, canlı API smoke, tarayıcı smoke ve Tauri paketleme  
**Değişiklik politikası:** Ürün kodu değiştirilmedi. Bu rapor dışında bilinçli bir kaynak dosyası eklenmedi veya düzenlenmedi. Kullanıcının mevcut Crypto demo hesabı resetlenmedi ve demo işlem gönderilmedi.
**Son revalidation snapshot:** 2026-09-23 01:15 Europe/Istanbul. Audit sırasında başka ekiplerin eşzamanlı değişiklikleri görüldüğü için lint/build ve test matrisi son dosya değişikliklerinden sonra tekrar çalıştırıldı.

## A. Yönetici Özeti

**Karar: Branch production/release için hazır değil.**

Temel ürün yollarının önemli bölümü çalışıyor:

- `gemini-3.6-flash` gerçek API isteği ve E.D.I.T.H. `/api/chat` SSE yolu başarılı.
- Voice Room yükleniyor ve doğru `gemini-3.1-flash-live-preview` modelini gösteriyor.
- Computer Use native köprüsü oturum, kill switch ve allowlist ile sınırlandırılmış; Rust testleri geçti.
- Crypto Demo Exchange canlı Binance public verisini, mevcut 10.000 CR demo hesabını ve Jev kararlarını gösteriyor; gerçek emir yolu kapalı.
- Obsidian vault bağlı, okunabilir/yazılabilir ve watcher aktif.
- TypeScript lint, web/server build, Rust testleri, format kontrolü ve Tauri MSI/NSIS üretimi geçti.

Ancak release'i engelleyen kritik sorunlar var:

1. Express `0.0.0.0:3000` üzerinde kimlik doğrulamasız çalışıyor; izin politikası, grant, tool, Crypto ve Obsidian mutation endpointleri ağdan erişilebilir.
2. Legacy tool yolu `authorizedPermissions` değerini doğrudan istemci body'sinden kabul ediyor.
3. Kalıcı canlı izin politikası `full_access`; high-risk izinler varsayılan yetkili listede.
4. Paketlenmiş Tauri uygulamasında Express/Node backend sidecar veya otomatik backend başlatma mekanizması yok.
5. Obsidian `read_only` modu yazma fonksiyonlarında zorlanmıyor; yazma endpointleri permission katmanını atlıyor.
6. Gemini health gerçek provider probe yapmadığı için çalışan anahtarı `pending/UNKNOWN` gösteriyor; auto route çalışan Gemini yerine mock seçiyor.
7. Temiz final revalidation'da 36 E.D.I.T.H. testinin 30'u geçti, 6'sı kaldı. Crypto UI altı viewport'ta geçti; önceki denemede gözlenen HMR port kapanış yarışı process-cleanup riski olarak kaydedildi. Ek Crypto recovery UI testinde ayrıca DOM yarış koşulu oluştu.
8. `npm audit --omit=dev` üç orta seviye prod dependency açığı buldu.

## B. Çalıştırılan Komutlar

Ana kalite kapıları:

```powershell
npm run lint
npm run build
git diff --check
npm audit --omit=dev --json
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
npm run tauri:build
python -m compileall -q crypto Mark-LIV-main
```

Test matrisi:

```powershell
# package.json içindeki 36 test:edith-* scriptinin tamamı
npm run test:edith-persistence
...
npm run test:edith-crypto-hardening

python crypto/test_modules.py
python crypto/test_runtime_reliability.py
node scripts/test-edith-crypto-recovery.mjs
node scripts/test-edith-crypto-ui-states.mjs
node scripts/test-edith-crypto-real-recovery.mjs
npm run smoke:gemini
npm run services:status
npx tsx scripts/test-edith-workspace.ts
```

Canlı smoke:

- `/api/health`, `/api/providers`, `/api/providers/health`, `/api/models`
- `/api/chat` Gemini, mock ve capability-registry SSE akışları
- `/api/voice/live/status`
- `/api/computer-use/status`
- `/api/edith/kill-switch`, `/api/edith/permissions/policy`, `/api/edith/permissions/grants`
- `/api/edith/skills`, `/api/edith/tools`, `/api/edith/capabilities`, `/api/edith/capabilities/summary`
- `/api/obsidian/status`, `/api/knowledge/status`
- `/api/crypto/status`, `/api/crypto/jev/status`
- Tarayıcıda Voice Room, Computer Use, Crypto, Tools/MCP ve Settings
- Release `edith.exe` başlatma smoke'u; QA ile açılan release süreci test sonunda kapatıldı

## C. Geçen Alanlar

### Build ve statik

- `npm run lint`: **PASS**
- `npm run build`: **PASS**
- `git diff --check`: **PASS**, yalnızca LF/CRLF dönüşüm uyarıları
- Rust: **4/4 PASS**
- `cargo fmt --check`: **PASS**
- Python `compileall`: **PASS**
- Yeni Workspace sidecar testi: **PASS**; Unicode/portable/read-only/migration/API senaryoları geçici dizinde doğrulandı. Bu script henüz `package.json` test matrisine kayıtlı değil.
- `npm run tauri:build`: **PASS**
- MSI: `src-tauri/target/release/bundle/msi/E.D.I.T.H._1.0.0_x64_en-US.msi`
- NSIS: `src-tauri/target/release/bundle/nsis/E.D.I.T.H._1.0.0_x64-setup.exe`

### E.D.I.T.H. test matrisi

- Toplam: **36**
- Geçen: **30**
- Kalan: **6**

Geçen önemli testler: providers, model router, chat context, interaction safety, voice room, computer use, kill switch, capabilities, Obsidian, Crypto/Jev, Crypto UI ve Crypto hardening.

### Runtime ve UI

- Browser UI normal dev modunda açıldı.
- Voice Room, Computer Use ve Crypto ekranları yüklendi.
- 1280 px viewport'ta yatay taşma görülmedi.
- İncelenen akışlarda browser console error/warning görülmedi.
- Emergency Stop görünür kaldı.
- Crypto birkaç saniyelik yükleme sonrası Binance public fiyat, order book, 10.000 CR demo ledger ve geçmişi gösterdi.
- Gerçek Crypto mutation veya reset yapılmadı.

## D. Başarısız Testler

### D1. `test:edith-skills`

Beklenen Jev durumu `config_required`, gerçek durum `degraded`.

- Test `JEV_API_KEY` değerini silse de çalışan `localhost:5000` Crypto servisini sorguluyor.
- Servis Jev için `configured:true`, `available:null`, `status:configured` döndürüyor.
- Registry bunu `degraded` olarak eşliyor; test dış runtime'a bağımlı ve deterministik değil.
- Kaynak: `scripts/test-edith-skills.ts:76`, `src/edith/skillRegistry.ts:180`, `src/edith/skillRegistry.ts:207`.

### D2. `test:edith-mark-l`

`mark_l_capabilities` çağrısı `success:false` döndü; test `true` bekliyor.

- Test temp çalışma dizini kullanmıyor ve ana `.edith` durumunu okuyor.
- Canlı emergency stop aktif olduğu için tool execution güvenli biçimde bloklanıyor.
- Kaynak: `scripts/test-edith-mark-l.ts:28`.

### D3. `test:edith-verifier`

Executor gerçek durumda görevi `COMPLETED` yapıyor; test `VERIFYING` bekliyor.

- Kaynak: `scripts/test-edith-verifier.ts:57`, `src/edith/executor.ts:211`.

### D4. `test:edith-recovery`

Retryable verification sonrası görev `VERIFYING` kalıyor; test `RETRYING` bekliyor.

- Kaynak: `scripts/test-edith-recovery.ts:54`, `src/edith/verifier.ts:128`.

### D5. `test:edith-auth-persona`

Stale kaynak testi `src/components/chat/ChatPanel.tsx` içinde persona/auth literal'i arıyor; persona akışı artık üst seviye aktif view/state üzerinden geliyor.

- Kaynak: `scripts/test-edith-auth-persona.ts:32` ve `:38`.

### D6. `test:edith-task-queue`

Pause uygulaması `BLOCKED` üretiyor; test `PAUSED` bekliyor.

- Kaynak: `scripts/test-edith-task-queue.ts:40`, `src/edith/taskQueueService.ts:61`.

### D7. Ek Crypto test sorunları

- `crypto/test_modules.py`: **FAIL (2)**
  - Eski `100.0` başlangıç bakiyesi bekliyor; ürün sözleşmesi artık 10.000 CR.
  - `/health` içinde Crypto Obsidian alanını zorunlu bekliyor; aktif Crypto Obsidian özelliği kapalı.
- `scripts/test-edith-crypto-recovery.mjs`: **FAIL**
  - `İşlem durumunu tekrar kontrol et` düğmesi click sırasında DOM'dan ayrılıyor ve Playwright 30 saniye timeout oluyor.
  - Aynı dosyanın proxy, timeout, idempotency ve çoğu recovery senaryosu bu noktaya kadar geçti.
- `test_runtime_reliability.py`, `test-edith-crypto-real-recovery.mjs` ve `test-edith-crypto-ui-states.mjs`: **PASS**.

### D8. Intermittent `test:edith-crypto-ui` ortam hatası

Temiz final revalidation sonucu **PASS**.

- 390, 768, 1366, 1440, 1920 ve 2560 px viewport'ların layout, endpoint ve nonblank chart kontrolleri geçti.
- Test sonunda browser console gate'i `ws://127.0.0.1:24678` HMR bağlantısı için `ERR_CONNECTION_REFUSED` gördü.
- Önceki dev sunucusu başlarken aynı port için `Port 24678 is already in use` uyarısı üretildi; o deneme browser error gate'ini kırdı.
- Port tamamen serbest bırakılıp temiz dev sunucusu açıldığında test altı viewport'ta browser hatası veya Crypto write isteği olmadan geçti.
- Bu bir Crypto layout regresyonu değil; dev/Tauri process ownership ve cleanup yarışıdır.

## E. Runtime Regresyonları

1. `npm run services:status` backend, providers ve Obsidian'ı aynı anda `timeout` raporladı; doğrudan çağrılarda backend yaklaşık 100 ms, providers 3-4 ms idi.
2. `/api/obsidian/status` yaklaşık 3,0 saniye sürüyor. Status içinde graph snapshot alınması ve runtime verisinin tekrar persistence'a yazılması Node event loop'u bloke ediyor.
3. Crypto UI recovery recheck düğmesi async state değişiminde DOM'dan ayrılabiliyor.
4. Ana bundle `669.16 kB` minified / `198.90 kB` gzip; Vite 500 kB uyarısı veriyor.
5. Tauri build iki Rust uyarısı veriyor: kullanılmayan `tauri::Manager` importu ve `app` parametresi.
6. `services:status` exit code 0 ile tamamlanıyor; kritik servis timeout'ları CI gate'i kırmıyor.
7. Eski Tauri/dev süreci `24678` HMR portunu tutuyor; yeni Vite instance'ı socket açamıyor ve Crypto UI browser error gate'i kalıyor.

## F. Provider Durumu

### Gemini text

**Kısmi PASS.**

- `GEMINI_API_KEY` backend environment'tan okunuyor: `server/providers/gemini.ts:32`.
- Kaynakta gerçek hardcoded Gemini anahtarı bulunmadı; eşleşmeler test fixture'larıydı.
- Frontend provider/model payloadlarında anahtar değeri yok.
- Eksik/placeholder anahtar app'i çökertmiyor ve `configuration_required` olarak normalize ediliyor.
- `smoke:gemini`: HTTP 200, `gemini-3.6-flash`, yanıt `GEMINI_OK`.
- `/api/chat` gerçek SSE smoke: yanıt `EDITH_GEMINI_RELEASE_QA_OK`; tek `done` olayı; resolved provider/model doğru; `fallbackUsed:false`.
- Mock/degraded sohbet yolu çalışıyor.
- Ollama offline ve dürüstçe `offline/network_error` raporlanıyor.

**Sorunlar:**

- `/api/providers/health` geçerli anahtar için bile ağ probe yapmadan `pending`, `available:false`, `healthy:false` döndürüyor: `server/providers/gemini.ts:226`.
- Auto route bu nedenle çalışan Gemini'yi atlayıp mock seçiyor ve bunu `fallbackUsed:false` olarak raporluyor.
- UI Gemini'yi `UNKNOWN` gösteriyor; boot ekranında geçerli anahtara rağmen `CONFIGURATION REQUIRED` görülebiliyor.
- Settings key formu backend'e istek göndermiyor; yalnızca input'u temizliyor: `src/components/ui/edithOS.tsx:4075`. Aynı ekran anahtarın backend session env'ine yazıldığını iddia ediyor: `src/components/ui/edithOS.tsx:4182`.
- Aktif text default doğru `gemini-3.6-flash`; `gemini-2.5-pro` yalnızca alternatif listede. Legacy Mark-L yollarında eski 2.5 modelleri kalmış.

## G. Voice Durumu

**Test ve yükleme PASS, runtime dürüstlüğü kısmi FAIL.**

- `test:edith-voice-room`: **PASS**.
- UI Voice Room yükleniyor ve model `gemini-3.1-flash-live-preview`.
- Browser smoke'ta rozet `OFFLINE`, session `Idle`, WebSocket `Not started`, Audio `Waiting`; sahte aktif oturum gösterilmedi.
- API anahtarı yalnızca backend'de; UI `Backend protected` gösteriyor.
- Input/output transcription ve interrupt/barge-in kod yolu mevcut.

Riskler:

- `/api/voice/live/status` aynı anda `connected:false`, `runtimeStatus:offline`, fakat `available:true`, `status:available`, `ttsOutputConnected:true`, `bargeInEnabled:true` döndürüyor. Yapılandırılmış ile aktif session ayrımı alan bazında çelişkili.
- Gemini SDK socket `onopen` anında `listening` yayınlıyor; gerçek `setupComplete` daha sonra geliyor: `server/voice/geminiLiveProvider.ts:93`.
- Frontend `listening` durumunu connected kabul ediyor: `src/edith/voiceLiveClient.ts:109`. Setup tamamlanmadan kısa süreli `Connected/Listening` riski var.
- Assistant transcript event'leri biriktirilmek yerine `setJarvisReply(event.text)` ile overwrite ediliyor: `src/components/ui/edithOS.tsx:2000`.
- Gerçek mikrofon + Gemini Live ses oturumu bu browser smoke'ta başlatılmadı; browser preview modu voice action'ı disabled gösterdi.

## H. Computer Use / Tauri Durumu

### Geçen güvenlik kontrolleri

- Rust native testleri: 4/4 PASS.
- `test:edith-computer-use`: PASS.
- Owner Command session varsayılan kapalı.
- Emergency stop aktif.
- Native action öncesi canlı session ve kill switch kontrolü var.
- Windows MessageBox owner onayı ve yaklaşık 5 dakikalık session sınırı var.
- Native bridge'de keyfi shell yok; app launcher yalnızca Notepad/Calculator allowlist kullanıyor.
- Fare/klavye köprüsü Rust tarafında gerçek `SendInput`/`SetCursorPos` kullanıyor.
- Screenshot yalnızca Windows primary display ile sınırlı; bu limit status'ta açıkça yazıyor.

### Canlı durum

- `/api/computer-use/status`: `runtime:tauri`, `mode:disabled`, `status:blocked`, owner command inactive, kill switch true.
- Screen/mouse/keyboard `error`, overlay `ready`; overlay alanı genel readiness ile çelişiyor.
- Browser UI: `unbound`, `read_only`, kontroller missing; Tauri gereksinimini dürüstçe gösteriyor.
- Release EXE açıldı ve ayrı proses olarak çalıştı; QA ile açılan release prosesi kapatıldı.

### Release riskleri

- Tauri build frontend'i paketliyor fakat Express `server.cjs`, Node runtime veya backend sidecar tanımlamıyor: `src-tauri/tauri.conf.json:5`.
- MSI/NSIS üretimi standalone uygulamanın API'leri çalıştırdığını kanıtlamıyor; smoke sırasında backend zaten ayrıca çalışıyordu.
- CSP `null`: `src-tauri/tauri.conf.json:28`.
- Capability seti `shell:allow-open` ve geniş `http:default` içeriyor: `src-tauri/capabilities/default.json:5`.
- Runtime heartbeat yalnızca loopback + sabit header kontrolüne dayanıyor; yerel süreç tarafından spoof edilebilir.
- Tek adımlı native eylemlerde işlem başladıktan sonra interrupt noktası yok; uzun typing akışı karakterler arasında kontrol ediyor.

## I. Skill Registry Durumu

**Endpoint smoke PASS, test izolasyonu FAIL.**

- `/api/edith/skills`: erişilebilir, 14 skill.
- `/api/edith/tools`: erişilebilir, payload yaklaşık 37 kB.
- `/api/edith/capabilities`: erişilebilir, payload yaklaşık 29 kB.
- `/api/edith/capabilities/summary`: erişilebilir ve kompakt, yaklaşık 2 kB.
- Capability sorusu `/api/chat` üzerinden provider'a gitmeden local `edith-skill-registry` yanıtı ve tek `done` olayı üretti.
- `supabase_registry`, `skill_store`, `file_organizer`, `release_builder` planned durumda; ready olarak gösterilmiyor.

Sorunlar:

- Registry okuması canlı Crypto ve Obsidian servislerine bağlı; salt registry testi deterministik değil.
- `/api/edith/skills` ilk çağrı yaklaşık 3 saniye sürdü; Obsidian status yan etkisini taşıyor.
- UI Tools/MCP ekranı ilk 500 ms snapshot'ta hâlâ “Yetenek durumları yükleniyor...” gösterdi.

## J. Obsidian Durumu

**Bağlantı PASS, güvenlik/performance FAIL.**

Canlı status:

- Vault: `D:\EDİTH\EDİTH`
- `connected`, `readable:true`, `writable:true`, `watcherActive:true`
- 83 indexed note, 292 node, 933 edge, 5000 chunk
- Skill/System/Tools notlarında başarılı write + watcher index olayları mevcut
- Unicode path testi geçti.
- Body secret redaction testi geçti.
- Kullanıcı vault'unda QA amaçlı not silme veya reset yapılmadı.

Kritik/önemli sorunlar:

1. Son eşzamanlı değişiklikten sonra `read_only` reindex artık vault'u değiştirmiyor ve testi geçiyor. Ancak açık yazma yollarının kullandığı `writeEntityNoteStatus()` / `ensureVaultStructure()` hâlâ mode kontrolü yapmıyor: `src/edith/obsidianVaultService.ts:733`, `:876`.
2. `/api/knowledge/write-note` ve `/api/edith/obsidian/agent-notes` permission katmanını atlıyor: `server/routes/knowledge.ts:224`, `:241`.
3. Secret redaction yalnızca body üzerinde; title/provider/model/assistant gibi frontmatter değerleri redakte edilmeden yazılabilir.
4. Silinen not Obsidian indexinde soft-delete oluyor fakat ilişkili RAG node/chunk'ları kalabilir; arama deleted filtresi uygulamıyor: `src/edith/ragService.ts:83`.
5. `status()` 5000 node snapshot alıyor ve read endpoint'inde runtime ingest/write yapıyor; yaklaşık 3 saniye bloklama oluşuyor.
6. Reindex yalnızca var olan dosyaları geziyor; watcher'ın kaçırdığı silmeleri uzlaştıramıyor.
7. `fs.watch` runtime `error` event'i izlenmiyor; `watcherActive` yalnızca watcher nesnesinin varlığına bakıyor.

Bu test Obsidian senkronizasyon/indekslemeyi doğrular; bağımsız backup, snapshot veya versioned restore sistemi olduğunu kanıtlamaz.

## K. Crypto Durumu

**Demo çekirdeği güçlü PASS; ağ güvenliği ve bir UI recovery yarışı FAIL.**

Doğrulanan davranışlar:

- Binance bağlantı modu `PUBLIC_MARKET_DATA`; credential kullanılmıyor.
- Yeni demo hesap sözleşmesi 10.000 CR.
- Kullanıcının mevcut hesabı korunuyor; otomatik reset yapılmadı.
- Canlı hesapta başlangıç 10.000 CR, mevcut equity yaklaşık 9.996 CR ve 7 geçmiş demo işlem UI'da görüntülendi.
- `liveExecutionEnabled:false`, `paperTradingEnabled:false`, `realMoneyUsed:false`, `realOrderEndpointsAvailable:false`.
- UI açıkça `DEMO MODE`, `NO REAL MONEY`, `NO REAL ORDERS`, `LIVE TRADING DISABLED` gösteriyor.
- Idempotency request fingerprint'i kalıcı.
- Operation, decision ve trade ID bağlantıları korunuyor.
- HOLD trade üretmiyor.
- Stale fiyat BUY/SELL'i engelliyor.
- Reset açık loop/pending operation sırasında bloklanıyor ve önceki session'ı arşivliyor.
- İzole gerçek-public-data smoke'ta buy response kaybı recovery, replay, HOLD, SELL ve Jev kararı geçti.
- Jev `jev-1.13.0` ile geçerli HOLD üretti; gerçek emir gönderilmedi.

Riskler:

- Express ve Python Crypto servisleri `0.0.0.0` üzerinde dinleyebiliyor.
- Demo buy/sell/HOLD/reset ve Jev loop mutation endpointlerinde auth/permission middleware yok.
- Reset confirmation sabit `RESET_DEMO_ACCOUNT`; kullanıcı/session bağlı onay değil.
- UI recovery recheck düğmesinde DOM detach yarışı var.
- Legacy `test_modules.py` güncel 10.000 CR sözleşmesine taşınmamış.

## L. Güvenlik Bulguları

### Kritik

1. **Unauthenticated LAN API:** Express `server.ts:1692` ile `0.0.0.0` üzerinde. Auth, CSRF ve rate limit katmanı yok.
2. **Client-supplied permission bypass:** `server.ts:964` body'den `authorizedPermissions` alıyor; `permissionService.ts:199` bunları yetkili kabul ediyor.
3. **Canlı politika full access:** Runtime policy `full_access`; `system:exec`, `file:write`, `browser:control`, `computer:control`, `iot:control`, `trading:execute` authorized listede. Aktif kill switch şu an koruyor, fakat deactivate endpointi auth'suz.

### Yüksek

4. Permission policy/grant, kill-switch deactivate, tool/task, Crypto ve Obsidian mutation endpointleri owner auth olmadan erişilebilir.
5. Tauri CSP kapalı ve HTTP/shell-open scope geniş.
6. Obsidian read-only enforcement ve write endpoint permission kontrolü eksik.
7. Silinen Obsidian içerik RAG katmanında kalabilir.
8. Obsidian frontmatter secret redaction kapsamı eksik.

### Orta

9. Integration `apiKey` ve webhook alanları `localStorage` içine yazılıyor: `src/lib/storage.ts:773` ve `:791`.
10. Runtime heartbeat sabit header ile spoof edilebilir.
11. `npm audit`: `express`, `body-parser`, `qs` zincirinde 3 moderate; fix available.

### Olumlu kontroller

- Takip edilen kaynaklarda gerçek hardcoded Gemini/Binance/Supabase/private-key değeri bulunmadı.
- Provider, model, voice ve Computer Use status payloadlarında API key değeri görünmedi.
- Tauri capability içinde shell execute/spawn izni yok.
- Computer Use native action'ları owner session + kill switch ile korunuyor.
- Crypto gerçek order/withdraw/deposit endpointi içermiyor.

## M. UI Clutter Bulguları

- Ürün odağı için ayrı `Voice Room / Computer Use / Crypto` workspace mevcut ve temiz birincil görünüm sunuyor.
- Buna rağmen normal sidebar'da 18 eş düzey sekme var.
- Computer Use 5., Crypto 12., Voice 14. sırada; developer yüzeyleri (Agents, Tasks, Browser, Knowledge Graph, Tools/MCP, Security, System) aynı ağırlıkta.
- Header'daki `Bilgisayar SADECE OKUMA` ve bazı güvenlik etiketleri canlı policy ile tamamen bağlı değil; runtime `full_access` iken yanıltıcı olabilir.
- Gemini manuel sohbet çalışsa da global header/provider rozetleri `UNKNOWN`.
- Settings key copy, gerçek uygulama davranışıyla çelişiyor.
- Crypto yükleme sırasında tüm değerler `- / UNKNOWN`; birkaç saniye sonra doğru canlı veriye dönüyor. Loading/degraded ayrımı daha açık olabilir.

Bu audit UI redesign önermiyor; yalnızca ürün odağı ve durum dürüstlüğü riskini kaydediyor.

## N. Dirty Tree / Runtime Dosya Hijyeni

Çalışma ağacı audit sırasında yoğun biçimde kirliydi ve başka ekip değişiklikleri devam ediyordu. Başlangıç commit'i `77b194c`; yaklaşık 50 tracked dosya modified, çok sayıda untracked Crypto/Computer Use/Skill/Workspace dosyası mevcut.

Disk kullanımı:

| Yol | Dosya | Boyut |
|---|---:|---:|
| `src-tauri/target` | 12.678 | 11.411,57 MB |
| `crypto/.venv` | 14.175 | 421,68 MB |
| `crypto/data` | 5 | 183,33 MB |
| `.edith` | 36 | 69,53 MB |
| `logs` | 29 | 13,80 MB |
| `artifacts` | 65 | 10,00 MB |
| `crypto/logs` | 8 | 7,30 MB |
| `dist` | 4 | 0,89 MB |

- Runtime dizinlerinin çoğu `.gitignore` kapsamında ve tracked runtime DB/log bulunmadı.
- `artifacts/` ignore kapsamında değil ve tamamı untracked; bilinçli QA artifact politikası belirlenmeli.
- Testler `crypto/data/test_agent_memory.db` gibi ignored runtime dosyaları oluşturabiliyor.
- Bazı SQLite temp dizinleri Windows handle'ı nedeniyle otomatik silinemedi.
- Repo içindeki `edith-promo-landing/ai programs tester` HTTrack mirror/cache benzeri tracked içerik release yüzeyini ve secret scan gürültüsünü büyütüyor.
- AURA user-facing aktif kimlik bulunmadı. Kalan referanslar `.aura_monitors.json`, tarihsel QA dokümanları, legacy localStorage migration ve görsel “aura” değişkeni.

## O. Önem Sıralı Sorunlar

### P0 / Kritik

1. API'nin `0.0.0.0` üzerinde auth'suz çalışması.
2. Request body `authorizedPermissions` ile permission escalation.
3. `full_access` + unauthenticated policy/grant/kill-switch mutation zinciri.

### P1 / Yüksek

4. Tauri release paketinde backend sidecar/startup eksikliği.
5. Obsidian read-only ve permission bypass sorunları.
6. Silinen Obsidian verisinin RAG'de kalma ihtimali.
7. Obsidian frontmatter secret redaction eksikliği.
8. Gemini health/auto-router yanlışlığı.
9. Voice setup tamamlanmadan connected/listening riski.
10. Altı kırmızı ana test, intermittent HMR port kapanış yarışı ve Crypto recovery UI yarışı.

### P2 / Orta

11. `services:status` false timeout ve başarılı exit code.
12. Tauri CSP/HTTP/shell-open kapsamı.
13. Integration secret'larının localStorage kullanması.
14. Üç moderate npm advisory.
15. 669 kB frontend bundle ve ağır monolitler.
16. Release portability: Windows `.venv\\Scripts\\python.exe`, `D:\EDİTH\EDİTH`, `rm -rf` clean scripti.
17. Process cleanup belirsizliği; audit sonunda QA dışı eski debug E.D.I.T.H. ve Crypto processleri gözlendi.

### P3 / Düşük

18. UI developer clutter.
19. Tarihsel AURA ve legacy model referansları.
20. Rust unused import/parameter uyarıları ve CRLF gürültüsü.

## P. Kesin Sonraki Düzeltmeler

1. Dev varsayılan bind adresini `127.0.0.1` yap; LAN erişimini açık opt-in'e çevir.
2. Tüm mutation endpointlerine owner-authenticated session, CSRF ve rate limit ekle.
3. `authorizedPermissions` alanını request body'den kaldır; yalnız server-side policy + süreli grant kullan.
4. Default/migration policy'yi `ask` veya `deny` yap; kalıcı `full_access` durumunu kapat.
5. Kill-switch deactivate, permission grant/policy, tool execution, Crypto reset/trade/loop ve Obsidian write endpointlerini aynı auth kapısına al.
6. Tauri için backend sidecar/service mimarisi kur; Node/Express/Python bağımlılıklarını installer içinde doğrula ve standalone test ekle.
7. CSP tanımla; `http:default` ve `shell:allow-open` scope'unu gereken origin/URL'lerle sınırla.
8. Gemini health'e kısa timeoutlu, cache'li gerçek probe ekle; başarılı chat sonrası health cache'i available yap.
9. Auto route mock'a düştüğünde `fallbackUsed:true` ve degraded metadata üret.
10. Settings API-key formunu ya güvenli backend-only session endpointine bağla ya kaldır; yanıltıcı copy'yi düzelt.
11. Voice `connected` durumunu yalnız `setupComplete` sonrası yayınla; available/configured/session-active alanlarını ayır.
12. Assistant transcript delta'larını biriktir; final event'te finalize et ve test ekle.
13. Obsidian `read_only` kontrolünü her write yolunun içinde zorunlu kıl; write endpointlerini permission gate'e al.
14. Secret redaction'ı frontmatter değerlerine uygula; silinen notların node/chunk'larını tombstone/filter et.
15. Obsidian status'tan ingest/write işini çıkar; cache/background incremental index kullan.
16. Altı ana testte implementation-vs-contract veya runtime-isolation kararını belgeleyip test ve kodu aynı sözleşmeye getir; beklentiyi sessizce değiştirme.
17. Skill testinde Crypto/Jev ve provider kaynaklarını fixture ile izole et; Mark-L testini temp persistence ile çalıştır.
18. Crypto recovery düğmesine stable state/idempotent click testi ekle; DOM detach yarışını gider.
19. `test_modules.py` beklentilerini 10.000 CR ve disabled Crypto Obsidian sözleşmesine taşı.
20. `express/body-parser/qs` güncelle; audit'i CI gate yap.
21. Tek fail-fast olmayan QA komutunda lint, build, 36 E.D.I.T.H. testi, ek Crypto recovery/runtime testleri, Rust ve audit sonuçlarını topla.
22. `artifacts/`, temp SQLite kalıntıları ve 11+ GB Tauri target için cleanup/retention politikası ekle.
23. Aktif olmayan view/import/fonksiyonları temizle veya lazy-load et; sonra `noUnusedLocals` ve `noUnusedParameters` aç.

## Son Karar

**Branch yalnızca kontrollü yerel geliştirmeye devam etmek için koşullu olarak güvenli.** Emergency stop aktif kalmalı; port 3000 ve Crypto portu LAN'a açılmamalı; mevcut `full_access` policy güvenli varsayım kabul edilmemeli.

**Branch production-ready değildir.** P0 güvenlik sınırı, Tauri standalone backend, Obsidian permission/read-only sorunları, Gemini/Voice durum doğruluğu ve kırmızı test matrisi çözülmeden release yapılmamalıdır.
