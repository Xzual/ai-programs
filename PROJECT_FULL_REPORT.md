# AURA / E.D.I.T.H Proje Raporu

**Tarih:** 14 Ağustos 2026  
**Proje tipi:** Yerel AI asistan dashboard'u  
**Ana stack:** React + TypeScript + Vite + Express + Three.js  
**Çalışma modu:** Local-first, Ollama destekli, Gemini/mock fallback'li AI arayüzü

---

## 1. Kısa Özet

AURA / E.D.I.T.H, yerel makinede çalışan futuristik bir AI asistan arayüzüdür. Uygulama; sohbet, kod odaklı chat, kişisel bellek, otomasyon araçları, Knowledge Map, EDITH operasyon ekranı, tema/persona sistemi, sesli giriş/çıkış ve Three.js tabanlı 3D AI çekirdeği sunar.

Proje tek bir klasör altında üç ana sistem içerir:

| Sistem | Açıklama |
|---|---|
| `src/`, `server.ts`, `src-tauri/` | Ana AURA / E.D.I.T.H web ve desktop uygulaması |
| `Mark-L-main/` | Python tabanlı Gemini Live / voice assistant denemesi |
| `crypto/` | Paper-trading odaklı ayrı crypto ajan sistemi |

Ana ürün şu anda **AURA / E.D.I.T.H dashboard** tarafıdır.

---

## 2. Projenin Ne Yaptığı

Bu proje kullanıcının yerel bilgisayarında çalışan, görsel olarak gelişmiş bir kişisel AI kontrol paneli sağlar.

Başlıca kabiliyetler:

- Yerel Ollama modelleriyle chat.
- Gemini veya mock cevap motoruna fallback.
- Streaming cevap üretimi.
- Türkçe sesli komut alma.
- AI cevaplarını sesli okutma.
- Kişisel bellek kayıtları tutma.
- Araç/otomasyon çalıştırma.
- Görev ve audit altyapısı.
- Bilgi, araç ve görev ilişkilerini Knowledge Map içinde görselleştirme.
- Tema/persona seçimine göre tüm UI rengini değiştirme.
- Ortada canlı, durum bazlı 3D AI çekirdeği gösterme.

---

## 3. Teknoloji Mimarisi

| Katman | Kullanılan Teknoloji |
|---|---|
| Frontend | React 19, TypeScript |
| Build sistemi | Vite |
| Stil sistemi | Tailwind CSS 4, CSS değişkenleri |
| İkonlar | Lucide React |
| Animasyon / görsel efekt | Motion, Three.js, WebGL |
| Backend | Express, Node.js, TypeScript |
| AI sağlayıcıları | Ollama, Gemini, mock fallback |
| Ses | Browser Web Speech API, Speech Synthesis, Web Audio API |
| Desktop hedefi | Tauri altyapısı mevcut |
| Test / doğrulama | `npm run build`, `npm run lint`, Playwright görsel kontrol |

Önemli dosyalar:

- `src/App.tsx`
- `server.ts`
- `src/lib/storage.ts`
- `src/components/3d/ParticleCore.tsx`
- `src/components/chat/ChatPanel.tsx`
- `src/components/chat/VoiceBar.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/Header.tsx`
- `src/components/views/KnowledgeMapView.tsx`
- `src/config/assistantProfiles.json`

---

## 4. Ana Uygulama Ekranları

### Dashboard / Sohbet

Ana kullanım ekranıdır. Ortada 3D AI çekirdeği, sağ tarafta sohbet paneli, altta metin ve ses giriş çubuğu bulunur.

Özellikler:

- AI durumları: `idle`, `listening`, `thinking`, `speaking`, `error`
- Streaming chat yanıtları
- Sesli giriş
- Otomatik seslendirme
- Mesaj kopyalama
- Mesajı tekrar sesli okutma
- Ollama bağlantı durumu
- Tema/persona uyumlu görsel yapı

### Kod Chat

Kod yazma ve yazılım soruları için ayrı tutulmuş chat ekranıdır.

Özellikler:

- Normal sohbetten ayrı oturum
- Kod odaklı sistem prompt'u
- Daha düşük temperature
- Markdown kod bloklarını düzgün gösterme
- Kod kopyalama
- Hızlı prompt butonları

### Bellek

Kullanıcının kalıcı bilgilerini ve tercihlerini saklayan bölümdür.

Bellek kategorileri:

- Kullanıcı tercihi
- Gerçek / bilgi
- Özet
- Özel kayıt

Şu anda bellek verileri tarayıcı `localStorage` üzerinde saklanır.

### Knowledge Map

Sistemdeki bellekler, araçlar, görevler ve audit logları arasındaki ilişkileri görsel harita olarak sunar.

Güncel tasarım özellikleri:

- Tema uyumlu arka plan ve grid
- Kavisli bağlantı çizgileri
- Core, Memory, Tools, Tasks ve Audit hub node'ları
- Seçili node odak halkası
- Sağ tarafta inspector paneli
- Arama alanı
- Metrik kartları
- Node tipleri legend'ı
- Son aktivite paneli
- Daha az kalabalık oluşturan etiket davranışı

### Otomasyonlar

Yerel araçların listelendiği ve çalıştırıldığı ekrandır.

Örnek araçlar:

- Yerel klasör listeleme
- Metin dosyası okuma
- Sohbeti Markdown olarak dışa aktarma
- Hatırlatıcı oluşturma
- Sistem analitik özeti
- Web araması
- Sistem durumu izleme
- Tarayıcı açma
- AI skill katalog görüntüleme
- Browser/computer control placeholder araçları

### EDITH Ops

EDITH çekirdek operasyonlarını izlemeye yönelik yönetim ekranıdır.

İzlenen alanlar:

- Tool registry
- Task kayıtları
- Audit event'leri
- Sistem operasyon sinyalleri

### Entegrasyonlar

Harici servis bağlantılarının yönetildiği bölümdür. Entegrasyon bilgileri şimdilik `localStorage` üzerinden tutulur.

### Ayarlar

Model, ses, persona ve davranış ayarlarının yönetildiği ekrandır.

Ayar başlıkları:

- AI provider
- Ollama URL
- Seçili model
- Temperature
- Sistem prompt'u
- STT / TTS ayarları
- Persona / tema
- Auto speech
- Hands-free mode
- Memory enabled
- Animasyon kalitesi

---

## 5. AI ve Sohbet Akışı

Backend tarafında ana sohbet endpoint'i:

```text
POST /api/chat
```

Çalışma akışı:

1. Kullanıcının mesajı alınır.
2. Mesajın tool veya görev niyeti taşıyıp taşımadığı kontrol edilir.
3. Görev oluşturma, sistem durumu, web araması veya tarayıcı açma gibi istekler EDITH registry'ye yönlendirilir.
4. Normal sohbetlerde önce Ollama denenir.
5. Ollama çalışmıyorsa Gemini fallback denenir.
6. Gemini de yoksa yerel mock cevap motoru devreye girer.
7. Cevap SSE/streaming formatında frontend'e akar.

Desteklenen provider'lar:

| Provider | Rol |
|---|---|
| `ollama` | Ana local LLM sağlayıcısı |
| `gemini` | Bulut fallback sağlayıcısı |
| `mock` | Offline/demo cevap motoru |

---

## 6. Backend Endpoint Envanteri

| Endpoint | Amaç |
|---|---|
| `POST /api/voice/tts` | TTS ses üretimi |
| `GET /api/health` | Ollama ve sistem bağlantı kontrolü |
| `GET /api/edith/tools` | EDITH registry araçlarını listeleme |
| `GET /api/edith/skill-catalog` | AI skill katalog verisi |
| `GET /api/edith/audit` | Audit event okuma |
| `GET /api/edith/tasks` | EDITH task listesi |
| `POST /api/edith/tasks` | Yeni task oluşturma |
| `PATCH /api/edith/tasks/:id/status` | Task durum güncelleme |
| `GET /api/ollama/models` | Ollama model listesi |
| `POST /api/chat` | Chat streaming endpoint'i |
| `POST /api/tools/execute` | Tool çalıştırma endpoint'i |
| `GET *` | SPA fallback |

---

## 7. 3D AI Çekirdeği

`ParticleCore.tsx`, uygulamanın ortasındaki canlı AI görünümünü üretir.

Özellikler:

- Three.js / WebGL tabanlı parçacık çekirdeği
- Persona rengine göre dinamik renk
- AI durumuna göre hız, parlaklık ve hareket değişimi
- Web Audio analyser ile sese duyarlı hareket
- FPS ölçümü
- Performans düşerse parçacık sayısını azaltma
- Mouse wheel ile zoom
- Pointer drag ile döndürme

Son bug fix:

- HOMER temasında görülen beyaz/lila patlama ve kırpılma sorunu düzeltildi.
- Sabit lila glow texture kaldırıldı.
- Glow artık aktif tema renginden üretiliyor.
- Açık temalarda parlaklık, particle size, ölçek ve kamera mesafesi dengelendi.
- Zoom alt limiti yükseltildi.

---

## 8. Tema ve Persona Sistemi

Tema profilleri şu dosyada tutulur:

```text
src/config/assistantProfiles.json
```

Mevcut personlar:

| ID | İsim | Görsel Kimlik |
|---|---|---|
| `jarvis` | JARVIS | Mavi taktik arayüz |
| `friday` | F.R.I.D.A.Y. | Mor/pembe intelligence layer |
| `ultron` | ULTRON | Altın/endüstriyel arayüz |
| `karen` | KAREN | Kırmızı güvenlik arayüzü |
| `alfred` | ALFRED | Yeşil operasyon arayüzü |
| `homer` | HOMER | Beyaz/grafit executive arayüz |

Aktif profil şu CSS değişkenlerine aktarılır:

```css
--edith-primary
--edith-secondary
--edith-accent
--edith-bg
--edith-surface
--edith-text
```

Bu değişkenler sayesinde logo, menüler, chat paneli, input alanları, butonlar ve 3D çekirdek aynı renk moduna uyum sağlar.

---

## 9. Tool ve Otomasyon Altyapısı

Frontend tarafında araç tanımları `DEFAULT_TOOLS` içinde tutulur. Backend tarafında EDITH tool registry çalışır.

Registry kabiliyetleri:

- Tool metadata
- Input/output schema
- Permission listesi
- Risk seviyesi
- Timeout
- Dry-run desteği
- Audit event üretimi
- High-risk tool gate

Önemli registry araçları:

| Tool | Amaç |
|---|---|
| `system_monitor` | Sistem durumu izleme |
| `task_create` | EDITH task oluşturma |
| `browser_open` | Tarayıcı açma |
| `browser_search` | Web arama akışı |
| `ai_skill_catalog` | Skill katalog verisi |
| `browser_use_agent` | Browser control placeholder |
| `playwright_browser_agent` | Playwright agent placeholder |
| `open_interpreter_agent` | Interpreter placeholder |
| `computer_control_agent` | Computer control placeholder |

Yüksek riskli araçlar varsayılan olarak kapalıdır. Açılması için backend şu env ile başlatılmalıdır:

```bash
EDITH_ENABLE_HIGH_RISK_TOOLS=true
```

---

## 10. Görev ve Audit Sistemi

EDITH core içinde typed task modeli bulunur.

Task alanları:

- ID
- Başlık
- Amaç
- Orijinal kullanıcı isteği
- Priority
- Status
- Dependencies
- Subtasks
- Required tools
- Required permissions
- Risk level
- Checkpoints
- Artifacts
- Observations
- Audit events

Task kayıtları şu dosyada saklanır:

```text
.edith/tasks.json
```

Audit sistemi tool çalıştırmalarını kaydeder:

- Actor
- Tool ID
- Authorization
- Risk level
- Result
- Message
- Timestamp

---

## 11. Veri Saklama

Frontend `localStorage` anahtarları:

| Anahtar | İçerik |
|---|---|
| `aura_settings_v1` | Kullanıcı ayarları |
| `aura_chat_sessions_v1` | Sohbet oturumları |
| `aura_active_session_id_v1` | Aktif sohbet ID |
| `aura_code_chat_session_v1` | Kod chat oturumu |
| `aura_memories_v1` | Bellek kayıtları |
| `aura_tool_logs_v1` | Tool çalışma logları |
| `aura_integrations_v1` | Entegrasyon ayarları |

Backend tarafında kullanılan kayıtlar:

- `.edith/tasks.json`
- Audit JSONL kayıtları

Not: Bir sonraki mimari adım, bu verileri daha sağlam bir SQLite tabanlı local persistence katmanına taşımaktır.

---

## 12. Workspace İçindeki Yardımcı Sistemler

### Mark-L-main

Python tabanlı ayrı bir asistan sistemidir.

İçerdiği parçalar:

- Gemini Live voice assistant
- OS action modülleri
- Browser kontrol modülleri
- Screen processing
- File actions
- Reminder/proactive modules
- PyQt UI
- Dashboard server

Durum: Ana AURA sistemiyle tam birleşik değildir. İleride permission-gated adapter ile entegre edilmesi önerilir.

### crypto

Paper-trading odaklı ayrı bir ajan sistemidir.

İçerdiği parçalar:

- Market data
- Technical analysis
- Risk management
- Paper trading engine
- Ollama decision engine
- SQLite state
- Flask dashboard

Durum: Canlı trading sistemi değildir. Güvenli yaklaşım olarak önce read-only dashboard/status entegrasyonu önerilir.

---

## 13. Bu Sohbette Yapılan Değişiklikler

### 13.1 Tema Rengi Düzeltmeleri

Seçili persona renginin UI'ın daha fazla yerine uygulanması sağlandı.

Güncellenen alanlar:

- Sol logo
- Sidebar aktif menü
- Sidebar ikonları
- Chat panel bot/user avatarları
- Chat balon border ve shadow renkleri
- Chat header ikonu
- VoiceBar input focus
- VoiceBar gönder butonu
- VoiceBar dinleme göstergeleri
- Code Chat ana ikonları ve butonları
- Header test/aksiyon ikonları

Sonuç: Ortadaki 3D çekirdek hangi tema rengindeyse, çevredeki menüler, logolar ve sohbet alanları da aynı tema diline daha iyi uyum sağlıyor.

### 13.2 Arka Plan Sedef Denemesi

Dashboard arka planına seçili temaya göre sedefli renk geçişi eklendi.

Durum:

- Kullanıcı isteğiyle bu son arka plan değişikliği geri alındı.
- Mevcut görünüm daha kontrollü, koyu ve sade arka plana döndü.

### 13.3 3D AI Çekirdeği Bug Fix

HOMER temasında ortadaki AI görünümü fazla büyük, parlak ve kırpılmış görünüyordu.

Düzeltmeler:

- Sabit lila glow kaldırıldı.
- Glow texture tema renklerine bağlandı.
- Açık temalarda parlaklık düşürüldü.
- Particle size dengelendi.
- Kamera mesafesi ve çekirdek ölçeği düzeltildi.
- Zoom sınırları daha güvenli hale getirildi.

### 13.4 Knowledge Map Tasarım Yenilemesi

Knowledge Map daha şık, okunabilir ve ürün hissi veren bir görünüme taşındı.

Yeni eklenen/güzelleştirilen parçalar:

- Modern header alanı
- Tema uyumlu grid arka plan
- Hub node düzeni
- Kavisli bağlantılar
- Metrik kartları
- Arama
- Seçili node inspector paneli
- Son aktivite paneli
- Node tipi legend'ı
- Daha temiz ikon ve etiket yerleşimi

### 13.5 Proje Dokümantasyonu

Projeye kapsamlı raporlama ve mimari dokümantasyon eklendi.

Eklenen/güncellenen dosyalar:

- `PROJECT_FULL_REPORT.md`
- `docs/BASELINE.md`
- `docs/ARCHITECTURE_SNAPSHOT.md`

---

## 14. Doğrulama Durumu

Çalıştırılan doğrulamalar:

```bash
npm run build
npm run lint
```

Sonuç:

| Kontrol | Durum |
|---|---|
| Vite build | Başarılı |
| Server bundle | Başarılı |
| TypeScript lint/check | Başarılı |
| Playwright görsel kontrol | Dashboard, 3D çekirdek ve Knowledge Map için kontrol edildi |

Ek not:

- `crypto/test_modules.py` sistem Python ortamında eksik paketler nedeniyle çalışmadı.
- `crypto/.venv` içindeki Python ile çalıştırıldığında test geçti.

---

## 15. Güçlü Yanlar

- Local-first AI deneyimi
- Ollama entegrasyonu
- Gemini fallback
- Streaming chat
- Futuristik 3D AI çekirdeği
- Sesli kullanım
- Ayrı kod chat ekranı
- Kişisel bellek sistemi
- Tool registry başlangıcı
- Görev ve audit modelinin temeli
- Knowledge Map ile sistem içgörüsü
- Persona tabanlı tema sistemi
- Tauri ile desktop paketleme potansiyeli

---

## 16. Riskler ve Eksikler

| Alan | Risk / Eksik |
|---|---|
| Persistence | Chat, bellek ve entegrasyonlar hâlâ ağırlıklı olarak `localStorage` kullanıyor |
| Tool sistemi | Frontend `DEFAULT_TOOLS` ve backend registry tam tek kaynak haline gelmemiş |
| Güvenlik | High-risk tool'lar kapalı ama ileride açılırsa daha güçlü izin modeli gerekir |
| Mark-L entegrasyonu | Ana uygulamaya doğrudan bağlı değil |
| Crypto entegrasyonu | Ana uygulamada read-only status olarak bağlanması daha güvenli olur |
| Test kapsamı | Frontend için otomatik UI/regression testleri artırılmalı |
| README | Eski mor/neon anlatımı yeni tema sistemiyle güncellenebilir |

---

## 17. Önerilen Sonraki Adımlar

1. Task, audit, memory ve tool run kayıtlarını SQLite tabanlı local persistence'a taşımak.
2. Frontend araç tanımları ile backend EDITH registry'yi tek kaynak haline getirmek.
3. Sensitive memory için ayrı güvenli depolama stratejisi eklemek.
4. Mark-L araçlarını permission-gated adapter üzerinden bağlamak.
5. Crypto ajanını önce sadece read-only dashboard/status entegrasyonu olarak eklemek.
6. Settings ve Memory ekranlarında kalan sabit renkleri tamamen CSS tema değişkenlerine taşımak.
7. README'yi güncel persona/tema/Knowledge Map yapısına göre yenilemek.
8. Playwright ile temel ekranlar için regression screenshot testleri eklemek.

---

## 18. Genel Sonuç

Proje şu an güçlü bir **yerel AI asistan dashboard'u** temeline sahip. Chat, ses, tema, 3D çekirdek, bellek, otomasyon, görev/audit sistemi, Knowledge Map ve entegrasyon ekranları çalışır durumda.

En büyük mimari kazanım, EDITH core/registry/task/audit modelinin başlamış olmasıdır. Bundan sonraki en önemli kalite sıçraması; veriyi `localStorage` ve JSON dosyalarından daha sağlam bir local database katmanına taşımak ve bütün tool sistemini backend-enforced tek registry üzerinden yönetmek olacaktır.
