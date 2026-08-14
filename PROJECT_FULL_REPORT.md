# AURA / E.D.I.T.H Proje Raporu

**Tarih:** 14 Ağustos 2026
**Proje adı:** AURA / E.D.I.T.H
**Açılım:** Enhanced Digital Intelligence & Task Handler
**Proje tipi:** Local-first kişisel yapay zeka asistanı ve AI operating layer
**Ana teknoloji:** React 19, TypeScript, Vite, Express, Three.js, SQLite
**Çalışma modeli:** Yerel Ollama öncelikli, Gemini ve mock fallback destekli

---

## 1. Kısa Özet

AURA / E.D.I.T.H, kullanıcının kendi bilgisayarında çalışan görsel, sesli ve görev odaklı bir yapay zeka asistanıdır. Proje ilk bakışta gelişmiş bir AI dashboard gibi görünse de altyapısı artık daha büyük bir hedefe taşınmaktadır: kullanıcının amacını anlayan, görev oluşturan, plan yapan, araç seçen, sonucu doğrulayan, hata durumunda yeniden planlayabilen ve önemli bilgileri belleğe kaydedebilen kalıcı bir kişisel AI işletim katmanı.

Mevcut uygulama sohbet, kod sohbeti, sesli giriş/çıkış, bellek paneli, Knowledge Map, otomasyon araçları, EDITH Ops, entegrasyonlar, ayarlar ve Three.js tabanlı canlı yapay zeka çekirdeği içerir.

Son geliştirmelerde özellikle mimari temel güçlendirildi: SQLite persistence, backend merkezli tool registry, IntentService, TaskService, Planner, Executor, Verifier, Recovery, Agent Registry, Mark-L adapter, Memory V2 ve ModelRouter foundation eklendi.

---

## 2. Proje Ne Yapıyor?

E.D.I.T.H şu anda şu ana yeteneklere sahiptir:

- Yerel Ollama modelleri ile sohbet eder.
- Ollama çalışmadığında Gemini veya mock yanıt motoruna düşebilir.
- Cevapları streaming olarak kullanıcıya aktarır.
- Türkçe sesli komut alabilir.
- AI cevaplarını sesli okuyabilir.
- Kullanıcı bilgilerini, tercihlerini ve proje notlarını bellek olarak saklayabilir.
- Görev kayıtları oluşturabilir ve görev durumlarını takip edebilir.
- Backend tarafında tanımlı araçları listeler, doğrular ve risk seviyesine göre çalıştırır.
- Araç çalıştırma, görev ve sistem olaylarını audit log olarak kaydeder.
- Knowledge Map ekranında bellek, görev, araç ve sistem ilişkilerini görselleştirir.
- Persona / tema seçimine göre arayüz, logo, sohbet alanı ve yapay zeka çekirdeği renklerini uyumlu hale getirir.
- Tauri altyapısı sayesinde masaüstü uygulamasına dönüştürülebilecek yapıdadır.

---

## 3. Workspace İçindeki Ana Sistemler

| Sistem | Konum | Açıklama | Durum |
|---|---|---|---|
| AURA / E.D.I.T.H App | `src/`, `server.ts`, `src-tauri/` | React + Express tabanlı ana ürün | Aktif |
| Mark-L | `Mark-L-main/` | Python Gemini Live, ses, ekran, OS action ve browser kontrol denemeleri | Adapter ile bağlanmaya hazır temel |
| Crypto Agent | `crypto/` | Market data, teknik analiz, risk yönetimi, paper trading ve Flask dashboard | Ayrı sistem, ileride adapter hedefli |

Ana ürün şu anda AURA / E.D.I.T.H uygulamasıdır. Mark-L ve crypto klasörleri korunmaktadır; amaç bunları doğrudan karıştırmak değil, güvenli adapter katmanlarıyla EDITH Core'a bağlamaktır.

---

## 4. Teknoloji Mimarisi

| Katman | Kullanılan yapı |
|---|---|
| Frontend | React 19 + TypeScript |
| Build | Vite + esbuild |
| Stil | Tailwind CSS 4 + CSS değişkenleri |
| İkon | Lucide React |
| Animasyon | Motion |
| 3D / WebGL | Three.js |
| Backend | Express + Node.js |
| AI sağlayıcıları | Ollama, Gemini, mock fallback |
| Ses | Web Speech API, Speech Synthesis, Web Audio API |
| Persistence | SQLite foundation + JSON/JSONL uyumluluk |
| Desktop | Tauri |
| Test | TypeScript check, Vite build, özel EDITH servis testleri |

Önemli dosyalar:

| Dosya | Rol |
|---|---|
| `src/App.tsx` | Ana uygulama kabuğu, ekran geçişleri ve state yönetimi |
| `server.ts` | Express API, chat, tools, task ve memory endpointleri |
| `src/lib/storage.ts` | Frontend ayarlar, local storage ve tool metadata hydration |
| `src/components/3d/ParticleCore.tsx` | Ortadaki canlı Three.js AI çekirdeği |
| `src/components/chat/ChatPanel.tsx` | Sohbet paneli |
| `src/components/chat/VoiceBar.tsx` | Sesli/metin giriş alanı |
| `src/components/views/KnowledgeMapView.tsx` | Knowledge Map ekranı |
| `src/components/layout/Sidebar.tsx` | Sol menü ve marka alanı |
| `src/components/layout/Header.tsx` | Üst bar, model ve yeni sohbet aksiyonları |
| `src/edith/serverRegistry.ts` | Backend merkezli tool registry |
| `src/edith/intent.ts` | Kullanıcı isteğini sınıflandıran IntentService |
| `src/edith/taskService.ts` | Kalıcı görev servis katmanı |
| `src/edith/planner.ts` | Structured Planner foundation |
| `src/edith/executor.ts` | Görev adımlarını çalıştırma foundation |
| `src/edith/verifier.ts` | Sonuç doğrulama foundation |
| `src/edith/recovery.ts` | Hata sonrası recovery / replan foundation |
| `src/edith/agentRegistry.ts` | Agent mimarisi foundation |
| `src/edith/markLAdapter.ts` | Mark-L entegrasyon adapter temeli |
| `src/edith/memoryService.ts` | Memory V2 servis temeli |
| `src/edith/modelRouter.ts` | Ollama / Gemini / mock provider route temeli |
| `src/edith/knowledgeMapService.ts` | Gerçek EDITH state'inden Knowledge Map graph snapshot üretimi |
| `src/edith/persistence/` | SQLite ve JSON persistence katmanı |

---

## 5. Kullanıcı Arayüzü

### 5.1 Dashboard / Ana Sohbet

Ana ekran üç ana parçadan oluşur:

- Sol menü: Dashboard, Sohbet, Kod Chat, Bellek, Knowledge Map, Otomasyonlar, EDITH Ops, Entegrasyonlar ve Ayarlar.
- Orta alan: Three.js tabanlı canlı yapay zeka çekirdeği.
- Sağ alan: Sohbet geçmişi ve mesaj kartları.

Dashboard özellikleri:

- Streaming AI cevapları
- Ollama bağlantı durumu
- Model bilgisi
- Yeni sohbet butonu
- Ses aç/kapat
- Sohbet mesajı kopyalama
- Mesajı sesli okutma
- Auto Listen desteği
- Persona rengine göre değişen buton, logo, chat paneli ve çekirdek görünümü

### 5.2 Yapay Zeka Çekirdeği

Ortadaki görsel çekirdek Three.js ile render edilir. Duruma göre farklı animasyon ve renk davranışı gösterir:

| Durum | Davranış |
|---|---|
| `idle` | Sakin parçacık hareketi |
| `listening` | Dinleme durumuna uygun hareket |
| `thinking` | Daha yoğun hesaplama efekti |
| `speaking` | Cevap verirken aktif animasyon |
| `error` | Hata durumuna uygun görsel sinyal |

Son görsel çalışmalarda seçilen persona renginin sadece ortadaki çekirdekte değil, menülerde, chat alanında, ikonlarda ve logolarda da tutarlı görünmesi hedeflendi. Kullanıcının isteğiyle fazla baskın arka plan sedef efekti geri alındı; görünüm daha kontrollü bırakıldı.

### 5.3 Kod Chat

Kod odaklı konuşmalar için ayrı bir ekran bulunur.

Özellikler:

- Kod yazma ve hata çözme odaklı sohbet
- Markdown kod blokları
- Kod kopyalama
- Normal sohbetten ayrı bağlam
- Yazılım geliştirme odaklı prompt davranışı

### 5.4 Bellek

Bellek ekranı kullanıcının kalıcı bilgi ve tercihlerini yönetmek içindir.

Mevcut bellek kategorileri:

| Kategori | Amaç |
|---|---|
| Preference | Kullanıcı tercihleri |
| Fact | Kalıcı bilgiler |
| Summary | Özet bilgiler |
| Custom | Özel notlar |

Yeni Memory V2 altyapısı ile bellek artık daha gelişmiş tiplere hazırlanmıştır: working, episodic, semantic, preference, project, procedural ve failure memory.

### 5.5 Knowledge Map

Knowledge Map, EDITH'in kendi iç dünyasını görselleştiren introspection ekranıdır. Son tasarım çalışmalarıyla daha temiz ve modern hale getirildi.

İyileştirilen alanlar:

- Daha güçlü header düzeni
- Tema uyumlu arka plan
- Core, Memory, Tools, Tasks ve Audit node'ları
- Kavisli bağlantı çizgileri
- Arama alanı
- Metrik kartları
- Seçili node detay paneli
- Son aktivite paneli
- Node tipi legend'i
- Daha anlaşılır ikon ve etiket sistemi

Bu ekranın uzun vadeli hedefi sadece dekoratif bir grafik olmak değil; gerçek task, memory, tool, audit ve agent ilişkilerini canlı olarak göstermektir.

### 5.6 Otomasyonlar

Otomasyonlar ekranı EDITH'in kullanabileceği araçları listeler.

Örnek araçlar:

| Tool | Amaç |
|---|---|
| `system_monitor` | Sistem durumu izleme |
| `task_create` | EDITH görevi oluşturma |
| `browser_open` | Tarayıcı açma |
| `browser_search` | Web arama akışı |
| `ai_skill_catalog` | Skill katalog bilgisi |
| `browser_use_agent` | Browser control placeholder |
| `playwright_browser_agent` | Playwright agent placeholder |
| `open_interpreter_agent` | Interpreter placeholder |
| `computer_control_agent` | Computer control placeholder |

Yüksek riskli araçlar backend tarafında kapalı tutulur. Sadece frontend görünümüne güvenilmez; güvenlik backend policy ile korunur.

### 5.7 EDITH Ops

EDITH Ops ekranı sistemin operasyonel durumunu takip etmek içindir.

İzlenen alanlar:

- Tool registry
- Tool health
- Task kayıtları
- Audit eventleri
- Sistem operasyon sinyalleri
- Çalıştırma geçmişi

### 5.8 Entegrasyonlar

Harici servislerin ileride bağlanabilmesi için entegrasyon ekranı bulunur. Şu anda local-first mantık korunur; canlı entegrasyonlar güvenli adapter ve permission modeli tamamlandıkça genişletilmelidir.

### 5.9 Ayarlar

Ayarlar ekranında model ve davranış seçenekleri yönetilir.

Başlıklar:

- AI provider
- Ollama URL
- Seçili model
- Temperature
- Sistem prompt'u
- STT / TTS
- Persona / tema
- Auto speech
- Hands-free mode
- Memory enabled
- Animasyon kalitesi

---

## 6. AI ve Sohbet Akışı

Ana endpoint:

```text
POST /api/chat
```

Genel akış:

1. Kullanıcı mesajı backend'e gelir.
2. IntentService mesajın sohbet mi, görev mi, araç isteği mi olduğunu analiz eder.
3. Basit sohbetlerde model provider akışı çalışır.
4. Araç veya görev isteklerinde EDITH servisleri devreye girer.
5. Önce Ollama denenir.
6. Ollama ulaşılamazsa Gemini fallback denenir.
7. Gemini de yoksa mock cevap motoru çalışır.
8. Cevap frontend'e streaming olarak aktarılır.

Provider rolleri:

| Provider | Rol |
|---|---|
| Ollama | Ana local LLM |
| Gemini | Opsiyonel cloud fallback |
| Mock | Offline/demo fallback |

---

## 7. EDITH Core Durumu

E.D.I.T.H'in hedefi basit bir chatbot olmak değildir. Hedeflenen ana döngü:

```text
Kullanıcı amacı
→ Intent anlama
→ Context + memory toplama
→ Task oluşturma
→ Planlama
→ Risk / izin kontrolü
→ Agent seçimi
→ Tool seçimi
→ Execution
→ Observation
→ Verification
→ Gerekirse retry / replan
→ Sonuç
→ Memory update
→ Kullanıcı raporu
```

Şu ana kadar bu hedef için aşağıdaki foundation parçaları eklendi:

| Parça | Durum | Açıklama |
|---|---|---|
| Persistence foundation | Hazır | SQLite + JSON uyumluluk katmanı |
| Tool registry sync | Hazır | Backend registry frontend için authoritative kaynak oldu |
| Tool execution hardening | Hazır | Validation, timeout, risk gate ve audit güçlendirildi |
| IntentService | Hazır | Kullanıcı isteğini sınıflandırma temeli |
| TaskService | Hazır | Kalıcı task oluşturma ve yönetim temeli |
| Planner | Hazır | Structured plan üretme temeli |
| Executor | Hazır | Plan adımlarını kontrollü çalıştırma temeli |
| Verifier | Hazır | Sonuç doğrulama temeli |
| Recovery / Replanner | Hazır | Hata sonrası toparlanma ve yeniden planlama temeli |
| Agent Registry | Hazır | Agent seçimi ve capability modeli temeli |
| Mark-L Adapter | Hazır | Mark-L'i güvenli capability provider olarak bağlama temeli |
| Memory V2 | Hazırlanıyor / eklendi | Typed, scoped, provenance-aware server-side memory servisi |
| ModelRouter | Hazır | Ollama / Gemini / mock fallback sırasını capability ve privacy ipuçlarıyla merkezileştiren temel |
| Knowledge Map Real Data | Hazır | Persisted task, memory, tool, audit, agent ve model-router node'larından graph snapshot üretir |

---

## 8. Persistence ve Veri Saklama

Proje önce daha çok localStorage, JSON ve JSONL dosyalarına dayanıyordu. Yeni foundation ile server-side kalıcı veri katmanı eklenmiştir.

Hedef veri modeli:

- tasks
- task steps
- checkpoints
- tool runs
- audit events
- memories
- integrations
- scheduled jobs
- system events

Mevcut yaklaşım:

- SQLite varsayılan kalıcı store olarak konumlandırıldı.
- JSON/JSONL uyumluluk yolları korunuyor.
- Eski verilerin sessizce silinmemesi ana prensip.
- Migration scriptleri ile idempotent geçiş hedefleniyor.

İlgili dosyalar:

| Dosya | Açıklama |
|---|---|
| `src/edith/persistence/index.ts` | Persistence store seçimi |
| `src/edith/persistence/sqliteStore.ts` | SQLite store |
| `src/edith/persistence/jsonStore.ts` | JSON fallback store |
| `scripts/migrate-edith-persistence.mjs` | Migration scripti |
| `docs/PERSISTENCE_FOUNDATION.md` | Persistence dokümantasyonu |

---

## 9. Tool Registry ve Güvenlik

Tool registry artık backend merkezli düşünülmektedir. Frontend araç listesini backend'den hydrate eder; böylece UI ile gerçek çalıştırma politikası birbirinden kopmaz.

Tool metadata hedefleri:

- id
- name
- version
- description
- category
- input schema
- output schema
- permissions
- risk level
- timeout
- retry policy
- dry run desteği
- rollback desteği
- health status
- enabled state
- adapter
- platform
- dependencies

Güvenlik ilkeleri:

- Frontend güvenlik kaynağı değildir.
- Riskli araçlar backend gate ile korunur.
- High-risk browser/computer control varsayılan olarak kapalıdır.
- Tool inputları validate edilir.
- Tool çalıştırmaları audit'e yazılır.
- Timeout ve normalize error davranışı vardır.

---

## 10. Task Engine, Planner, Executor, Verifier

E.D.I.T.H artık görevleri sadece metin olarak tutan bir yapıdan daha fazlasına evrilmektedir.

### TaskService

Görevlerin kalıcı olarak oluşturulması, güncellenmesi ve takip edilmesi için foundation sağlar.

### Planner

Karmaşık kullanıcı amaçlarını yapılandırılmış plana dönüştürmek için eklendi. Plan çıktısı serbest metin olmak zorunda değildir; schema ile kontrol edilebilir bir yapıya hazırlanmıştır.

### Executor

Plan adımlarının sırasını, bağımlılıklarını, retry davranışını ve observation kayıtlarını yönetmek için temel sağlar.

### Verifier

Bir işin tamamlanmış sayılması için sadece "araç başarılı döndü" demek yeterli değildir. Verifier foundation, sonucu beklenen kriterlere göre kontrol etmek için eklendi.

### Recovery / Replanner

Hata oluştuğunda neden analizi, retry kararı ve gerektiğinde yeniden planlama için temel sağlar.

---

## 11. Memory V2

Memory V2, EDITH'in daha akıllı ve kontrollü hatırlama sistemi için eklendi.

Desteklenen bellek tipleri:

| Tip | Amaç |
|---|---|
| `working` | Geçici çalışma belleği |
| `episodic` | Yaşanmış olay / konuşma belleği |
| `semantic` | Genel bilgi |
| `preference` | Kullanıcı tercihi |
| `project` | Proje bağlamı |
| `procedural` | Nasıl yapılır bilgisi |
| `failure` | Hata ve recovery belleği |

Memory V2 alanları:

- id
- type
- scope
- content
- source
- provenance
- confidence
- importance
- sensitivity
- createdAt
- updatedAt
- lastAccessed
- ttlMs
- relatedEntityIds
- mergeOf

Yeni endpointler:

```text
GET    /api/edith/memory-v2
POST   /api/edith/memory-v2
GET    /api/edith/memory-v2/context
POST   /api/edith/memory-v2/merge
GET    /api/edith/memory-v2/export
DELETE /api/edith/memory-v2/:id
```

Mevcut davranış:

- Typed memory upsert
- Scope ve sensitivity desteği
- Keyword search
- Context retrieval
- Sensitive memory'yi default context'ten dışlama
- Conflict detection
- Merge
- Delete
- Export snapshot
- Audit event üretimi

---

## 12. Mark-L ve Crypto Entegrasyon Planı

### Mark-L

Mark-L ayrı bir Python capability provider olarak korunmalıdır. Doğrudan EDITH Core içine kopyalanmamalıdır.

Hedef akış:

```text
Mark-L
→ MarkLAdapter
→ EDITH Tool Registry
→ Permission / Risk
→ Task Executor
```

Potansiyel Mark-L kabiliyetleri:

- Screen capture
- Screen processing
- Uygulama açma
- Klavye / mouse operasyonları
- Browser control
- Dosya aksiyonları
- Reminder
- Sesle ilgili aksiyonlar

### Crypto

Crypto sistemi finans ve trading tarafında ayrı kalmalıdır. Gerçek para işlemleri doğrudan LLM'e bırakılmamalıdır.

Hedef güvenli akış:

```text
Market Data
→ Analysis
→ Strategy
→ Risk
→ Trade Proposal
→ Authorization
→ Execution Adapter
→ Post-trade Verification
→ Audit
```

Öncelik sırası:

1. Read-only status
2. Market data
3. Analytics
4. Portfolio / paper visibility
5. Paper trading actions
6. Çok daha sonra canlı trading

---

## 13. Son Yapılan Önemli Değişiklikler

| Alan | Değişiklik |
|---|---|
| Tema / persona renkleri | Seçilen persona renginin menü, chat, logo ve çekirdek tarafında daha tutarlı uygulanması hedeflendi |
| Yapay zeka çekirdeği | Ortadaki particle core görünümündeki taşma / ölçek hissi için düzeltmeler yapıldı |
| Knowledge Map | Daha modern, bilgi yoğun ve okunabilir tasarım uygulandı |
| Persistence | SQLite foundation eklendi |
| Tool registry | Backend authoritative registry yaklaşımı eklendi |
| Tool execution | Risk gate, timeout, validation ve audit davranışı güçlendirildi |
| IntentService | Chat / task / tool intent ayrımı için temel eklendi |
| TaskService | Kalıcı görev yönetimi için temel eklendi |
| Planner | Structured plan foundation eklendi |
| Executor | Plan adımı çalıştırma foundation eklendi |
| Verifier | Completion doğrulama foundation eklendi |
| Recovery | Retry ve replanning temeli eklendi |
| Agent architecture | Capability tabanlı agent registry temeli eklendi |
| Mark-L adapter | Mark-L entegrasyonu için güvenli adapter temeli eklendi |
| Memory V2 | Typed/scoped/provenance-aware memory servisi eklendi |
| ModelRouter | Ollama / Gemini / mock fallback sırası servis olarak merkezileştirildi |
| Knowledge Map real data | Knowledge Map backend snapshot endpoint'i ile gerçek EDITH state'inden beslenmeye başladı |
| Dokümantasyon | Baseline, architecture snapshot ve her foundation için dokümanlar oluşturuldu |

---

## 14. Test ve Doğrulama Komutları

Projede kullanılan ana doğrulama komutları:

```bash
npm run lint
npm run build
npm run test:edith-persistence
npm run test:edith-registry
npm run test:edith-intent
npm run test:edith-task-service
npm run test:edith-planner
npm run test:edith-executor
npm run test:edith-verifier
npm run test:edith-recovery
npm run test:edith-agents
npm run test:edith-mark-l
npm run test:edith-memory-v2
npm run test:edith-model-router
npm run test:edith-knowledge-map
```

Bu testler EDITH servislerinin temel regression davranışlarını korumak için eklenmiştir.

---

## 15. Mevcut Durum

| Alan | Durum |
|---|---|
| Ana UI | Çalışır durumda |
| Sohbet | Çalışır durumda |
| Ollama entegrasyonu | Ana provider olarak mevcut |
| Gemini fallback | Opsiyonel fallback olarak mevcut |
| Mock fallback | Offline/demo fallback olarak mevcut |
| Sesli giriş / çıkış | Mevcut |
| Knowledge Map | Görsel olarak iyileştirildi |
| Tool registry | Backend merkezli foundation hazır |
| Persistence | SQLite foundation hazır |
| Task engine | Foundation hazır, daha fazla entegrasyon gerekiyor |
| Planner / Executor / Verifier | Foundation hazır |
| Recovery | Foundation hazır |
| Memory V2 | Backend foundation hazır, frontend entegrasyonu sıradaki işlerden |
| ModelRouter | Foundation hazır; provider adapter, health cache ve metrics sıradaki işler |
| Knowledge Map | Backend-backed graph snapshot'a bağlandı; daha zengin filtreler ve canlı güncelleme sıradaki işler |
| Mark-L | Adapter foundation hazır |
| Crypto | Ayrı sistem olarak korunuyor |
| High-risk tools | Varsayılan kapalı, güvenlik modeli korunuyor |

---

## 16. Bilinen Eksikler ve Sonraki Adımlar

Öncelikli teknik işler:

1. Memory V2'nin frontend Bellek paneline bağlanması.
2. ContextService ile Memory V2'nin chat ve planner promptlarına kontrollü dahil edilmesi.
3. ModelRouter'ı provider adapter, health cache, latency/failure metrics ve task tipine göre route kararlarıyla genişletmek.
4. Knowledge Map'in filtre, task-step, artifact ve canlı güncelleme desteğiyle genişletilmesi.
5. Kill switch modelinin backend-enforced hale getirilmesi.
6. Mark-L adapter capability'lerinin kademeli olarak tool registry'ye bağlanması.
7. Crypto sisteminin önce read-only adapter olarak EDITH'e tanıtılması.
8. Voice tarafında wake word, VAD, streaming STT/TTS ve barge-in davranışının geliştirilmesi.
9. Browser/computer control için daha güçlü permission modeli.
10. Daha kapsamlı end-to-end test senaryoları.

---

## 17. Genel Değerlendirme

Proje artık sadece güzel görünen bir AI arayüzü değildir. Altta görev, planlama, araç, doğrulama, recovery, agent ve memory temelleri oluşmaya başlamıştır. Bu sayede E.D.I.T.H'in uzun vadeli yönü nettir:

```text
User → Prompt → LLM → Text
```

yerine:

```text
User Objective
→ Understand
→ Remember
→ Plan
→ Authorize
→ Delegate
→ Use Tools
→ Execute
→ Observe
→ Verify
→ Replan if needed
→ Complete
→ Remember
→ Report
```

Bu rapora göre proje iyi bir temel seviyeye gelmiştir. En önemli değer artık görünümden çok, görünmeyen zeka katmanında oluşmaktadır: kalıcı state, güvenli araç kullanımı, task lifecycle, doğrulama, recovery ve kontrollü memory.
