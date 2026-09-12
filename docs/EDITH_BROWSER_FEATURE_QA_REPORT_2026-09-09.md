# E.D.I.T.H. Browser Feature QA Report

Tarih: 2026-09-09  
Kapsam: Build, lint, provider/model entegrasyonu, masaüstü/web arayüz sekmeleri, güvenlik durumu, crypto/Obsidian gözlemi ve mevcut test regresyonları.  
Rol: Chat 8 QA / Test / Cleanup Team  

## Özet

Proje build ve TypeScript lint aşamalarını geçti. Uygulama `http://localhost:3000` üzerinde açıldı ve ana sekmeler tarayıcıda tek tek dolaşıldı. UI gezinmesinde kritik console hatası veya failed network request görülmedi.

Ancak branch üretime hazır değildir. Test paketinde 9 adet başarısız E.D.I.T.H. testi var. Chat gönderiminde yanıt akışı `THINKING` / `STREAMING` durumunda takılı kalabildi. Gemini yapılandırılmış görünüyor fakat mevcut anahtar geçersiz olduğu için provider unavailable dönüyor. Crypto servisi son testte offline göründü. Permission policy tarafında persisted `full_access` / `highRiskEnabled=true` görüldü; kill switch aktif olduğu için yüksek riskli aksiyonlar fiilen bloklu olsa da bu varsayılan güvenlik açısından ayrıca incelenmeli.

## A. Çalıştırılan Komutlar

```powershell
npm run build
npm run lint
npm run test:edith-providers
npm run test:edith-model-router
npm run test:edith-interaction-safety
npm run test:edith-*
npm run services:status
```

Dev server başlatma:

```powershell
$env:EDITH_CRYPTO_AUTOSTART='false'
$env:CRYPTO_TRADING_ENABLED='false'
$env:CRYPTO_PAPER_TRADING_ENABLED='false'
$env:CRYPTO_LIVE_TRADING_ENABLED='false'
npm run dev
```

API smoke testleri:

```text
GET http://localhost:3000/api/health
GET http://localhost:3000/api/providers/health
GET http://localhost:3000/api/models
GET http://localhost:3000/api/edith/crypto/status
GET http://localhost:3000/api/edith/obsidian/status
GET http://localhost:3000/api/edith/permissions/policy
GET http://localhost:3000/api/edith/kill-switch
```

Tarayıcı sekme smoke testleri:

```text
Komuta Merkezi
Sohbet
Ajanlar
Görevler
Bilgisayar Kullanımı
Tarayıcı
Bellek
Bilgi Grafiği
Otomasyonlar
Dosyalar
Kodlama
Alım Satım
Araçlar / MCP
Ses
Entegrasyonlar
Güvenlik
Sistem
Ayarlar
```

## B. Geçen Kontroller

- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm run test:edith-providers`: PASS.
- Uygulama normal browser/dev modunda açıldı.
- Ana UI sekmeleri açılabildi.
- Sekmeler arası geçişte console error, failed request veya HTTP `>=400` yakalanmadı.
- Ollama provider API sağlık durumunda available göründü.
- Mock provider API sağlık durumunda available göründü.
- Obsidian bağlantısı son testte connected göründü.
- Crypto trading UI tarafında live trading locked göründü.
- Kill switch aktif göründü.
- Gemini API key değeri terminale veya rapora yazdırılmadı.

## C. Başarısız Kontroller

### 1. E.D.I.T.H. test paketi

Toplu `test:edith-*` koşusunda sonuç:

```text
21 PASS
9 FAIL
```

Başarısız testler:

```text
test:edith-capabilities
test:edith-kill-switch
test:edith-mark-l
test:edith-model-router
test:edith-verifier
test:edith-recovery
test:edith-auth-persona
test:edith-task-queue
test:edith-interaction-safety
```

### 2. Chat smoke testi

Sohbet sekmesinde kısa test mesajı gönderildi:

```text
Kisa test: Bana sadece CALISIYOR yaz.
```

Mesaj UI'da gönderildi, ancak yaklaşık 18 saniye sonra durum hâlâ:

```text
AŞAMA THINKING
STREAMING
```

olarak görünüyordu. Console/network seviyesinde hata yakalanmadı. Bu davranış model yanıtı, stream kapanışı veya frontend completion state tarafında incelenmeli.

### 3. Gemini runtime durumu

Gemini provider yapılandırılmış görünüyor, fakat sağlık kontrolü geçersiz API key hatası dönüyor:

```text
gemini: unavailable
configured: true
errorCode: invalid_api_key
```

Terminalde tekrar eden log örneği:

```text
[AI Provider] provider=gemini model=gemini-2.5-flash success=false errorCode=invalid_api_key
```

Anahtar değeri yazdırılmadı.

## D. Build / TypeScript Durumu

`npm run build` başarılı:

```text
vite built 1692 modules
dist/index.html
dist/assets/index-VjhUfeZ4.css
dist/assets/index-jkUb-z5Y.js
dist/server.cjs
```

`npm run lint` başarılı:

```text
tsc --noEmit
```

TypeScript derleme hatası görülmedi.

## E. Gemini Entegrasyon Durumu

Geçenler:

- Provider listesinde Gemini görünüyor.
- Health endpoint Gemini için dürüst biçimde unavailable dönüyor.
- Missing/invalid key senaryosu uygulamayı crash etmedi.
- API key değeri frontend çıktısında veya localStorage kontrolünde görünmedi.
- Ollama/local fallback hâlâ available görünüyor.
- Mock provider available görünüyor.

Sorunlar:

- `.env` içinde Gemini key var gibi görünüyor, fakat key geçersiz. Değer güvenlik için okunmadı/yazdırılmadı.
- Geçersiz key nedeniyle terminalde sık `invalid_api_key` logu oluşuyor.
- `test:edith-model-router` başarısız: beklenen provider `ollama`, gerçek provider `gemini`.

İlgili başarısız çıktı:

```text
AssertionError: 'gemini' !== 'ollama'
at scripts/test-edith-model-router.ts:100:8
```

## F. Desktop / Tauri / Program Deneyimi Durumu

Gözlenenler:

- Normal browser/dev mod çalıştı.
- Startup/boot ekranı sahte online claim göstermeden kontrolleri bekler biçimde açıldı.
- Diagnostics/System ekranı dürüst degraded/configuration-required durumları gösterdi.
- Emergency stop / kill switch durumu API tarafında aktif göründü.
- Bilgisayar Kullanımı ekranı read-only cockpit ve approval-required mesajlarıyla açıldı.
- Tehlikeli butonlara tıklanmadı; QA kapsamında destructive aksiyon denenmedi.

Riskler:

- `/api/edith/permissions/policy` çıktısında `mode=full_access` ve `highRiskEnabled=true` görüldü.
- Kill switch aktif olduğu için yüksek riskli kabiliyetler bloklu görünüyor, fakat persisted policy varsayılanı ayrıca güvenlik incelemesi gerektiriyor.

## G. Crypto Durumu

Son testte:

```text
Crypto service: offline
Crypto trading: unavailable
```

UI Alım Satım ekranında:

```text
CRYPTO OBSERVER MODE
OFFLINE
OBSERVER STOPPED
LIVE TRADING LOCKED
PAPER TRADING DISABLED
```

Bu son testte EDITH'in crypto'yu offline göstermesi mevcut API sonucuyla tutarlı. Daha önce dış terminalden crypto açıkken EDITH tarafında kapalı görünme sebebi muhtemelen durumların tek etikete indirgenmesi:

- servis dışarıdan ulaşılabilir olabilir,
- EDITH tarafından yönetilen process çalışmıyor olabilir,
- observer/trading ayrı durumda olabilir.

Öneri: Crypto UI üç ayrı durumu göstermeli:

```text
Service reachable
Observer running
Managed by EDITH
```

Böylece dışarıdan çalışan crypto servisi "offline" gibi yanlış algılanmaz.

## H. Obsidian Durumu

Son testte Obsidian connected:

```text
Vault: D:\EDİTH\EDİTH
Readable: true
Writable: true
Indexed: 14
Nodes: 117
Chunks: 701
```

Not: Daha önce crypto tarafında `D:\EDİTH\EDİTH` yolunda Türkçe `İ` karakteri encoding bozulmasıyla görünebiliyordu. Python/terminal/env tarafında path bozulursa Obsidian export status `configuration_required` dönebilir. Bunun için ASCII bir junction path kullanılabilir:

```text
D:\EDITH\EDITH
```

## I. Güvenlik Bulguları

Olumlu:

- Gemini API key değeri terminale basılmadı.
- Frontend localStorage içinde API key görünmedi.
- Live trading UI tarafında locked/disabled göründü.
- Kill switch aktif.
- Computer control varsayılan olarak approval/read-only metinleriyle sınırlandırılmış göründü.

Riskli:

- Permission policy API çıktısı `full_access` / `highRiskEnabled=true` gösterdi.
- Yetkili high-risk capability listesinde şunlar göründü:

```text
system:exec
file:write
browser:control
computer:control
iot:control
trading:execute
```

Kill switch şu an bunları fiilen baskılıyor görünse de güvenli varsayılan için persisted policy davranışı denetlenmeli.

## J. Kalan AURA / EDITH Naming Durumu

Bu test turunda UI sekmelerinde belirgin user-facing AURA kimliği yakalanmadı. Ana görünür kimlik E.D.I.T.H. olarak göründü.

Yine de tam güvence için ayrıca şu aramalar önerilir:

```powershell
rg -n "AURA|Aura|aura" .
rg -n "fake|simulated|mock|online|live" src server scripts docs
```

Bu rapor turunda odak browser sekme testi ve runtime smoke olduğu için tüm metin içerikleri tek tek semantik olarak doğrulanmadı.

## K. Runtime Dosyaları / Repo Hijyeni

Önceki QA notlarından devam eden kontrol alanları:

- `.env` source'a commit edilmemeli.
- `.edith/` altındaki runtime policy/state dosyaları git ignore kapsamında doğrulanmalı.
- `logs/`, `data/`, `.venv/`, temp sqlite dosyaları ve test artifact klasörleri repo dışında tutulmalı.

Bu turda `.env` dosyasının metadata'sı görüldü, içeriği okunmadı:

```text
.env exists
.env.example exists
```

## L. Regresyon Riskleri

- Model router Gemini'yi Ollama yerine seçiyor olabilir; fallback önceliği veya test beklentisi netleştirilmeli.
- Chat stream tamamlanma sinyali UI'a ulaşmıyor olabilir.
- Kill switch / task queue / interaction safety durum isimleri test beklentileriyle ayrışmış.
- Mark-L adapter testinde permission/safety sözleşmesi kırılmış olabilir.
- Verifier/recovery state machine sonuçları test beklentisiyle uyumsuz.
- Auth/persona flow içinde `ChatPanel.tsx` beklenen role katılmıyor olabilir.
- Crypto dış process ile EDITH managed process ayrımı UI'da belirsiz.

## M. Önerilen Final Fixler

1. `.env` içindeki Gemini key'i geçerli anahtarla değiştir veya test ortamında kaldır. Geçersiz key varken provider unavailable olması doğru davranış.
2. Gemini health polling/log spam azaltılsın; invalid key aynı oturumda sürekli terminali doldurmamalı.
3. `test:edith-model-router` için fallback önceliği netleştirilsin: Gemini configured ama unavailable ise Ollama seçilmeli mi, yoksa Gemini tercih mi edilmeli?
4. Chat streaming tamamlanma akışı incelensin; backend SSE done event ve frontend message completion state kontrol edilmeli.
5. Permission policy persisted `full_access` davranışı audit edilsin; env unset iken güvenli default beklenmeli.
6. Crypto UI status modeli ayrıştırılsın: reachable, managed, observer, trading.
7. Obsidian path için Türkçe karakterli Windows yolunda encoding dayanıklılığı sağlansın veya ASCII junction önerisi dokümante edilsin.
8. Başarısız 9 E.D.I.T.H. testi tek tek düzeltilmeden branch production-ready kabul edilmemeli.

## N. Son Karar

Branch geliştirmeye devam etmek için kullanılabilir, ancak production-ready değildir.

Bloklayıcılar:

- 9 başarısız test
- Chat response streaming takılması
- Gemini invalid API key durumu
- Güvenlik policy tarafında `full_access` / high-risk persisted durum riski

Build/lint temiz olduğu için branch çökmüş durumda değil; fakat final release öncesi yukarıdaki riskler çözülmeli.
