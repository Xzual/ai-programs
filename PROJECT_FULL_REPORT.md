# AURA / E.D.I.T.H Proje Raporu

**Tarih:** 14 Agustos 2026  
**Proje tipi:** Local-first yapay zeka asistan dashboard'u  
**Ana stack:** React + TypeScript + Vite + Express + Three.js  
**Calisma modu:** Yerel Ollama odakli, Gemini/mock fallback destekli  
**Mimari hedef:** Chat dashboard'undan kalici, gorev yurutebilen E.D.I.T.H. AI operating layer'a evrilmek

---

## 1. Yonetici Ozeti

AURA / E.D.I.T.H, kullanicinin bilgisayarinda calisan, gizlilik odakli ve gelismis gorsel arayuze sahip bir yapay zeka asistan sistemidir. Proje su anda sohbet, kod chat, sesli giris/cikis, bellek, otomasyon araclari, Knowledge Map, EDITH Ops, entegrasyonlar, ayarlar ve Three.js tabanli canli AI cekirdegi sunar.

Son calismalarda proje yalnizca gorsel olarak degil, mimari olarak da guclendirildi. E.D.I.T.H. icin SQLite tabanli persistence temeli, backend-enforced tool registry, intent service, task service ve planner foundation eklendi. Bu, uygulamayi "AI dashboard" seviyesinden "amac anlayan, gorev olusturan, planlayan ve denetlenebilir sekilde arac calistirmaya hazirlanan" bir sisteme tasiyan temel altyapidir.

---

## 2. Proje Nedir?

AURA / E.D.I.T.H, yerel makinede calisan bir kisisel AI kontrol panelidir.

Temel olarak sunlari yapar:

- Yerel Ollama modelleri ile sohbet eder.
- Ollama calismadiginda Gemini veya mock cevap motoruna fallback yapar.
- Streaming cevap uretir.
- Turkce sesli komut alabilir.
- AI cevaplarini sesli okuyabilir.
- Kullanici tercihlerini ve bilgilerini bellek olarak saklar.
- Otomasyon araclari uzerinden sistem, dosya, web ve task operasyonlari yapar.
- Gorev ve audit kayitlari tutar.
- Knowledge Map ile bellek, arac, gorev ve sistem iliskilerini gorsellestirir.
- Persona secimine gore UI, logo, sohbet alani ve 3D cekirdek renklerini degistirir.
- Desktop paketleme icin Tauri altyapisi barindirir.

---

## 3. Workspace Icindeki Ana Sistemler

| Sistem | Konum | Aciklama | Durum |
|---|---|---|---|
| AURA / E.D.I.T.H App | `src/`, `server.ts`, `src-tauri/` | React + Express tabanli ana dashboard | Aktif ana urun |
| Mark-L | `Mark-L-main/` | Python Gemini Live, OS action, browser, screen ve voice assistant denemesi | Ayrik capability provider |
| Crypto Agent | `crypto/` | Market data, teknik analiz, risk yonetimi, paper trading, Flask dashboard | Ayrik finans/paper-trading sistemi |

Ana gelistirme odagi su anda AURA / E.D.I.T.H uygulamasidir. Mark-L ve crypto sistemleri korunmakta, ileride adapter mantigiyla E.D.I.T.H core'a baglanmasi hedeflenmektedir.

---

## 4. Teknoloji Mimarisi

| Katman | Teknoloji / Yapi |
|---|---|
| Frontend | React 19, TypeScript |
| Build | Vite, esbuild |
| Stil | Tailwind CSS 4, CSS degiskenleri |
| Ikon | Lucide React |
| Animasyon | Motion |
| 3D / WebGL | Three.js |
| Backend | Express + Node.js |
| AI Provider | Ollama, Gemini, mock fallback |
| Ses | Browser Web Speech API, Speech Synthesis, Web Audio API |
| Persistence | SQLite foundation + JSON/JSONL fallback |
| Desktop | Tauri |
| Test / Dogrulama | TypeScript check, Vite build, EDITH servis testleri |

Onemli dosyalar:

| Dosya | Rol |
|---|---|
| `src/App.tsx` | Ana uygulama kabugu ve ekran akislari |
| `server.ts` | Express API, chat, tools, task endpointleri |
| `src/lib/storage.ts` | Frontend storage, settings, tool metadata hydration |
| `src/components/3d/ParticleCore.tsx` | Ortadaki Three.js AI cekirdegi |
| `src/components/chat/ChatPanel.tsx` | Sohbet paneli |
| `src/components/chat/VoiceBar.tsx` | Ses/metin giris bari |
| `src/components/views/KnowledgeMapView.tsx` | Knowledge Map ekrani |
| `src/edith/serverRegistry.ts` | Backend EDITH tool registry |
| `src/edith/taskService.ts` | Kalici task service |
| `src/edith/intent.ts` | Intent anlama katmani |
| `src/edith/planner.ts` | Structured planner foundation |
| `src/edith/persistence/` | SQLite/JSON persistence katmani |

---

## 5. Ana Ekranlar ve Ozellikler

## 5.1 Dashboard / Sohbet

Ana kullanim ekranidir. Ortada 3D AI cekirdegi, sagda sohbet paneli, altta metin ve ses giris bari bulunur.

Ozellikler:

- Streaming AI cevaplari
- Ollama / Gemini / mock fallback
- Sesli komut alma
- AI cevabini sesli okutma
- Mesaj kopyalama
- Mesaji tekrar okutma
- Ollama baglanti durumu
- Persona renklerine uyumlu UI
- Duruma gore degisen AI cekirdegi: `idle`, `listening`, `thinking`, `speaking`, `error`

## 5.2 Kod Chat

Kod yazma ve yazilim sorulari icin ayrilmis sohbet ekranidir.

Ozellikler:

- Normal sohbetten ayri oturum
- Kod odakli sistem prompt'u
- Markdown kod bloklarini okunabilir gosterme
- Kod kopyalama
- Hizli prompt aksiyonlari

## 5.3 Bellek

Kullanici bilgileri, tercihler ve notlar icin bellek panelidir.

Bellek kategorileri:

| Kategori | Amac |
|---|---|
| Preference | Kullanici tercihleri |
| Fact | Kalici bilgi |
| Summary | Ozet bilgi |
| Custom | Ozel kayit |

Not: Frontend bellekleri halen localStorage tarafinda tutulabilir; server-side memory icin SQLite foundation hazirlanmistir.

## 5.4 Knowledge Map

Sistemin bellek, arac, gorev ve audit iliskilerini gorsel olarak gosteren introspection ekranidir.

Son tasarim iyilestirmeleri:

- Daha modern header
- Tema uyumlu arka plan ve grid
- Core, Memory, Tools, Tasks ve Audit hub node'lari
- Kavisli baglanti cizgileri
- Arama alani
- Metrik kartlari
- Secili node inspector paneli
- Son aktivite paneli
- Node tipi legend'i
- Daha temiz ikon, etiket ve yerlesim

## 5.5 Otomasyonlar

Yerel ve backend destekli araclarin listelendigi bolumdur.

Ornek araclar:

| Tool | Amac |
|---|---|
| `system_monitor` | Sistem durumu izleme |
| `task_create` | EDITH task olusturma |
| `browser_open` | Tarayici acma |
| `browser_search` | Web arama akisi |
| `ai_skill_catalog` | AI skill katalog bilgisi |
| `browser_use_agent` | Browser control placeholder |
| `playwright_browser_agent` | Playwright agent placeholder |
| `open_interpreter_agent` | Interpreter placeholder |
| `computer_control_agent` | Computer control placeholder |

Yuksek riskli araclar backend tarafinda kapali gelir. Acilmasi icin ek izin modeli ve environment gate gerekir.

## 5.6 EDITH Ops

EDITH cekirdek operasyonlarini izlemeye yarayan yonetim ekranidir.

Izlenen alanlar:

- Tool registry
- Task kayitlari
- Audit event'leri
- Sistem operasyon sinyalleri
- Tool health bilgileri

## 5.7 Entegrasyonlar

Harici servis baglantilari icin hazirlanan bolumdur. Simdilik temel entegrasyon ayarlari ve durumlari local-first mantikla tutulur.

## 5.8 Ayarlar

Model, ses, persona ve davranis ayarlari buradan yonetilir.

Basliklar:

- AI provider
- Ollama URL
- Secili model
- Temperature
- Sistem prompt'u
- STT / TTS
- Persona / tema
- Auto speech
- Hands-free mode
- Memory enabled
- Animasyon kalitesi

---

## 6. AI ve Sohbet Akisi

Ana backend endpoint:

```text
POST /api/chat
```

Akis:

1. Kullanici mesaji backend'e gelir.
2. IntentService mesajin sohbet mi, arac istegi mi, task istegi mi oldugunu anlamaya calisir.
3. Task, sistem durumu, web aramasi veya skill katalog gibi istekler EDITH servislerine yonlendirilir.
4. Normal sohbetlerde once Ollama denenir.
5. Ollama ulasilamazsa Gemini fallback denenir.
6. Gemini de kullanilamazsa mock cevap motoru devreye girer.
7. Cevap streaming olarak frontend'e aktarilir.

Provider rolleri:

| Provider | Rol |
|---|---|
| Ollama | Ana local LLM |
| Gemini | Opsiyonel cloud fallback |
| Mock | Offline/demo fallback |

---

## 7. E.D.I.T.H Core Durumu

Bu projede E.D.I.T.H, sadece bir sohbet botu degil; uzun vadede amac anlayan, plan yapan, arac secen, calistiran, sonucu dogrulayan ve hafizaya isleyen bir sistem olacak sekilde gelistirilmektedir.

Hedef davranis dongusu:

```text
Kullanici amaci
  -> Intent anlama
  -> Context / memory
  -> Task olusturma
  -> Planlama
  -> Risk / izin kontrolu
  -> Tool secimi
  -> Execution
  -> Observation
  -> Verification
  -> Gerekirse retry / replan
  -> Sonuc raporu
  -> Memory update
```

Mevcut tamamlanan temel katmanlar:

| Katman | Durum | Aciklama |
|---|---|---|
| Persistence foundation | Tamamlandi | SQLite store + JSON fallback |
| Tool registry sync | Tamamlandi | Frontend backend registry metadata'sini hydrate ediyor |
| Tool execution hardening | Tamamlandi | Input schema, permission, timeout, audit, tool run kaydi |
| IntentService | Tamamlandi | Chat/task/tool niyetlerini ayristiran ilk servis |
| TaskService | Tamamlandi | Kalici task, checkpoint, artifact, observation API'leri |
| Planner foundation | Tamamlandi | Structured plan ureten ilk deterministic planner |
| Executor foundation | Hazirlaniyor | Plan adimlarini calistiran temel executor uzerinde calisma var |
| Verifier | Siradaki buyuk adim | Task tamamlandi demeden once sonucu dogrulayacak katman |

---

## 8. Persistence ve Veri Saklama

Yeni backend persistence temeli SQLite uzerine kuruludur.

Runtime database:

```text
.edith/edith.db
```

Legacy dosyalar korunur:

```text
.edith/tasks.json
.edith/audit.log.jsonl
```

SQLite tablolar:

| Tablo | Amac |
|---|---|
| `schema_migrations` | Migration takibi |
| `tasks` | Kalici task kayitlari |
| `task_steps` | Task engine step temeli |
| `task_checkpoints` | Checkpoint kayitlari |
| `audit_events` | Audit event gecmisi |
| `memories` | Server-side memory foundation |
| `tool_runs` | Tool run gecmisi |

Migration komutu:

```bash
npm run edith:migrate
```

Davranis:

- SQLite DB yoksa olusturur.
- Tablolari idempotent sekilde kurar.
- Eski `.edith/tasks.json` verilerini silmeden import eder.
- Eski audit JSONL kayitlarini silmeden import eder.
- Tekrar calistirildiginda duplicate uretmez.
- SQLite uygun degilse JSON/JSONL fallback kullanabilir.

---

## 9. Backend API Envanteri

| Endpoint | Amac |
|---|---|
| `POST /api/chat` | Streaming sohbet endpoint'i |
| `POST /api/voice/tts` | TTS ses uretimi |
| `GET /api/health` | Sistem ve Ollama saglik kontrolu |
| `GET /api/ollama/models` | Ollama model listesi |
| `GET /api/edith/tools` | Backend registry tool listesi |
| `GET /api/edith/tools/health` | Tool health snapshot |
| `POST /api/tools/execute` | Tool calistirma |
| `GET /api/edith/tool-runs` | Tool run gecmisi |
| `GET /api/edith/audit` | Audit event okuma |
| `GET /api/edith/tasks` | Task listesi |
| `POST /api/edith/tasks` | Task olusturma |
| `PATCH /api/edith/tasks/:id/status` | Task status guncelleme |
| `POST /api/edith/tasks/:id/observations` | Task observation ekleme |
| `POST /api/edith/tasks/:id/checkpoints` | Task checkpoint ekleme |
| `POST /api/edith/tasks/:id/artifacts` | Task artifact ekleme |
| `POST /api/edith/tasks/:id/plan` | Task icin structured plan olusturma |
| `GET /api/edith/persistence` | Aktif persistence turu ve path bilgileri |
| `GET /api/edith/memories` | Server-side memory listesi |
| `POST /api/edith/memories` | Server-side memory upsert |
| `GET /api/edith/skill-catalog` | AI skill katalog verisi |
| `GET *` | SPA fallback |

---

## 10. Tema, Persona ve Gorsel Sistem

Persona tanimlari:

```text
src/config/assistantProfiles.json
```

Mevcut personlar:

| ID | Isim | Gorsel Kimlik |
|---|---|---|
| `jarvis` | JARVIS | Mavi taktik arayuz |
| `friday` | F.R.I.D.A.Y. | Mor/pembe intelligence layer |
| `ultron` | ULTRON | Altin/endustriyel arayuz |
| `karen` | KAREN | Kirmizi guvenlik arayuzu |
| `alfred` | ALFRED | Yesil operasyon arayuzu |
| `homer` | HOMER | Beyaz/grafit executive arayuz |

Tema CSS degiskenleri:

```css
--edith-primary
--edith-secondary
--edith-accent
--edith-bg
--edith-surface
--edith-text
```

Son UI renk duzeltmeleri:

- Sol logo tema rengine baglandi.
- Sidebar aktif menu ve ikonlari tema rengine uyumlu hale geldi.
- Chat panel bot/user avatarlari persona rengine baglandi.
- Chat balon border ve shadow renkleri tema degiskenleriyle calisir hale geldi.
- VoiceBar input focus, gonder butonu ve dinleme kontrolleri guncellendi.
- Header aksiyon ikonlari ve Code Chat parcalari tema ile daha uyumlu hale getirildi.
- Dashboard arka plan sedef denemesi kullanici istegiyle geri alindi.

---

## 11. Three.js AI Cekirdegi

`ParticleCore.tsx`, ortadaki canli AI gorselini uretir.

Ozellikler:

- WebGL/Three.js tabanli parcacik sistemi
- Persona rengine gore dinamik renk
- AI durumuna gore hiz, parlaklik ve hareket degisimi
- Web Audio analyser ile sese duyarlilik
- FPS olcumu
- Performans dusunce parcacik yogunlugunu azaltma
- Mouse wheel ile zoom
- Pointer drag ile dondurme

Son bug fix:

- HOMER temasinda gorulen beyaz/lila patlama ve kirpilma problemi duzeltildi.
- Sabit lila glow texture kaldirildi.
- Glow aktif tema renginden uretilir hale getirildi.
- Acik temalarda parlaklik ve particle size dengelendi.
- Cekirdek olcegi, kamera mesafesi ve zoom sinirlari daha guvenli hale getirildi.

---

## 12. Yapilan Onemli Degisiklikler

## 12.1 Proje Guvenligi ve Baseline

- Git repository guvenli sekilde hazirlandi.
- `.gitignore` iyilestirildi.
- Baseline dokumantasyonu eklendi.
- Mevcut kaynak kokleri, frontend/backend sinirlari, Mark-L ve crypto sistemleri incelendi.
- Mimari snapshot olusturuldu.

Ilgili dosyalar:

- `docs/BASELINE.md`
- `docs/ARCHITECTURE_SNAPSHOT.md`
- `EDITH_ARCHITECTURE_REPORT.md`

## 12.2 SQLite Persistence Foundation

- `src/edith/persistence/` altinda SQLite/JSON store abstraction kuruldu.
- Task, audit, memory ve tool run icin ilk kalici store modeli eklendi.
- Idempotent migration script eklendi.
- Backend task/audit endpointleri persistence abstraction uzerinden calisir hale getirildi.

Ilgili dosyalar:

- `src/edith/persistence/types.ts`
- `src/edith/persistence/sqliteStore.ts`
- `src/edith/persistence/jsonStore.ts`
- `src/edith/persistence/index.ts`
- `scripts/migrate-edith-persistence.mjs`
- `scripts/test-edith-persistence.mjs`
- `docs/PERSISTENCE_FOUNDATION.md`

## 12.3 Backend Tool Registry

- Backend registry frontend'e metadata saglayan authoritative kaynak haline getirilmeye baslandi.
- Frontend `GET /api/edith/tools` uzerinden registry bilgisini hydrate ediyor.
- Tool execution icin schema validation, permission gate, timeout, audit ve normalized error davranislari guclendirildi.
- Tool run kayitlari persistence katmanina yaziliyor.

Ilgili dosyalar:

- `src/edith/serverRegistry.ts`
- `src/lib/storage.ts`
- `scripts/test-edith-registry.ts`
- `docs/TOOL_REGISTRY_SYNC.md`
- `docs/TOOL_EXECUTION_HARDENING.md`

## 12.4 IntentService

- Chat mesajlari icin ilk structured intent anlama katmani eklendi.
- Sistem durumu, web aramasi, skill katalog ve task olusturma sinyalleri ayriliyor.
- `/api/chat` artik bu katmani kullanarak daha kontrollu yonlendirme yapabiliyor.

Ilgili dosyalar:

- `src/edith/intent.ts`
- `scripts/test-edith-intent.ts`
- `docs/EDITH_CORE_INTENT.md`

## 12.5 TaskService

- Task modeli kalici servis haline getirildi.
- Observation, checkpoint ve artifact API'leri eklendi.
- Task status guncellemeleri audit ile izlenebilir hale geldi.

Ilgili dosyalar:

- `src/edith/taskService.ts`
- `src/edith/taskStore.ts`
- `scripts/test-edith-task-service.ts`
- `docs/EDITH_TASK_SERVICE.md`

## 12.6 Planner Foundation

- Task icin structured plan ureten ilk deterministic planner eklendi.
- Plan adimlari, bagimliliklar, gerekli tool'lar, izinler, validation criteria ve stop condition bilgileri uretiliyor.
- Planner freeform prose yerine typed plan nesnesi uretir.

Ilgili dosyalar:

- `src/edith/planner.ts`
- `scripts/test-edith-planner.ts`
- `docs/EDITH_PLANNER_FOUNDATION.md`

## 12.7 Gorsel Tasarim Iyilestirmeleri

- Persona rengi UI geneline daha tutarli uygulandi.
- Knowledge Map tasarimi daha modern ve okunabilir hale getirildi.
- Chat paneli, logo, menuler ve butonlar secili tema ile daha uyumlu hale getirildi.
- HOMER temasindaki 3D cekirdek gorsel bug'i giderildi.
- Dashboard arka planinda denenmis sedef efekti kullanici istegiyle geri alindi.

---

## 13. Test ve Dogrulama Durumu

Kullanilan komutlar:

```bash
npm run edith:migrate
npm run test:edith-persistence
npm run test:edith-registry
npm run test:edith-intent
npm run test:edith-task-service
npm run test:edith-planner
npm run lint
npm run build
```

Dogrulama ozeti:

| Kontrol | Durum |
|---|---|
| SQLite migration | Basarili |
| Persistence testleri | Basarili |
| Registry testleri | Basarili |
| IntentService testleri | Basarili |
| TaskService testleri | Basarili |
| Planner testleri | Basarili |
| TypeScript lint/check | Basarili |
| Vite build | Basarili |
| Server bundle | Basarili |

Ek not:

- `crypto/test_modules.py`, sistem Python ortaminda eksik paketler nedeniyle sorun cikarabilir.
- `crypto/.venv` icindeki Python ile calistirildiginda crypto testleri gecmistir.
- `node:sqlite`, Node v22 uzerinde experimental warning uretebilir; calisma davranisi dogrulanmistir.

---

## 14. Guclu Yanlar

- Local-first AI deneyimi
- Ollama ile gizlilik odakli local LLM kullanim
- Gemini ve mock fallback
- Streaming chat
- Sesli giris/cikis
- Gelismis Three.js AI cekirdegi
- Persona tabanli tema sistemi
- Kisisel bellek paneli
- Tool registry ve audit temeli
- Kalici task service temeli
- Planner foundation
- Knowledge Map introspection ekrani
- Tauri desktop potansiyeli
- Mark-L ve crypto gibi genisletilebilir yan sistemler

---

## 15. Riskler ve Eksikler

| Alan | Risk / Eksik | Oneri |
|---|---|---|
| Frontend storage | Chat, ayar ve bazi bellekler localStorage'da | Kritik operational state'i backend persistence'a tasimak |
| Tool registry | Tum frontend legacy tool'lari henuz backend tek kaynak degil | DEFAULT_TOOLS'u display fallback seviyesine indirmek |
| Executor | Plan execution foundation henuz tamamlanma asamasinda | Executor + Verifier loop'u tamamlamak |
| Verifier | Task tamamlandi demeden once objektif dogrulama yok | File, tool result ve output bazli verifier eklemek |
| High-risk tools | Browser/computer control ileride ciddi risk tasir | Backend permission, allowlist, audit ve kill switch zorunlu |
| Mark-L entegrasyonu | Ayrik ve daha genis OS yetkileri var | Adapter + permission gate ile baglamak |
| Crypto | Finansal karar sistemi ayrik | Once read-only status, live trading'e gecmemek |
| Test kapsami | Frontend regression testleri sinirli | Playwright screenshot ve workflow testleri eklemek |

---

## 16. Onerilen Sonraki Adimlar

1. Executor foundation'i tamamlamak ve plan adimlarini guvenli sekilde calistirmak.
2. Verifier katmanini ekleyerek task sonucunu gercekten dogrulamak.
3. Retry / Replanner sistemi ile basarisiz adimlari kontrollu sekilde toparlamak.
4. Frontend localStorage kullanimlarini kademeli olarak backend SQLite persistence'a tasimak.
5. Tool registry'yi tam single source of truth haline getirmek.
6. Backend-enforced kill switch ve permission modeli eklemek.
7. Mark-L capability'lerini dogrudan kopyalamadan adapter olarak baglamak.
8. Crypto sistemini once read-only dashboard/status olarak entegre etmek.
9. Knowledge Map'i gercek persisted task, memory, tool run ve audit iliskilerinden beslemek.
10. Memory V2 icin episodic, semantic, preference, project ve failure memory ayrimini kurmak.

---

## 17. Genel Sonuc

Proje artik sadece gorsel olarak etkileyici bir AI dashboard degil; E.D.I.T.H. tarafinda kalici task, audit, tool registry, intent ve planner temelleri bulunan daha ciddi bir yerel AI isletim katmanina dogru ilerliyor.

Bugunku durumuyla AURA / E.D.I.T.H:

- Kullanici ile sohbet edebiliyor.
- Sesli etkilesim kurabiliyor.
- Yerel veya fallback AI provider'lari kullanabiliyor.
- Bellek ve otomasyon ekranlari sunuyor.
- Tool calistirmalarini daha kontrollu hale getiriyor.
- Task olusturup kalici olarak saklayabiliyor.
- Task icin structured plan uretebiliyor.
- Knowledge Map ile sistem durumunu gorsellestirebiliyor.

En kritik sonraki kalite sicrama noktasi, Planner'dan sonra Executor ve Verifier dongusunu tamamlamaktir. Bu tamamlandiginda E.D.I.T.H, sadece cevap veren bir arayuz olmaktan cikarak kullanici amaclarini kalici, denetlenebilir ve geri kazanilabilir gorevlere donusturen bir AI operating layer haline gelecektir.

