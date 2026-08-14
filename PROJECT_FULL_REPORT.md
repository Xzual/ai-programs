# AURA / E.D.I.T.H Proje Raporu

Tarih: 2026-08-14

## 1. Genel Özet

AURA / E.D.I.T.H, yerel makinede çalışan futuristik bir AI asistan dashboard'udur. Ana uygulama React + Vite frontend, Express backend, Ollama/Gemini/mock AI akışı, sesli giriş/çıkış, kişisel bellek, otomasyon araçları, görev/audit altyapısı ve Three.js tabanlı 3D parçacık çekirdeği içerir.

Bu workspace yalnızca tek bir uygulamadan oluşmaz. Klasör içinde üç ayrı yardımcı sistem bulunur:

- `src/`, `server.ts`, `src-tauri/`: Ana AURA / E.D.I.T.H dashboard uygulaması.
- `Mark-L-main/`: Python tabanlı Gemini Live / voice assistant sistemi.
- `crypto/`: Paper-trading odaklı crypto ajanı.

Ana ürün şu an AURA / E.D.I.T.H dashboard tarafıdır.

## 2. Teknoloji Yapısı

| Katman | Teknoloji |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Stil | Tailwind CSS 4, CSS değişkenleri |
| 3D görsel | Three.js / WebGL |
| Backend | Express + Node.js |
| AI sağlayıcıları | Ollama, Gemini, mock fallback |
| Ses | Browser Web Speech API, Web Audio API, TTS endpoint |
| Desktop hedefi | Tauri dosyaları mevcut |
| Doğrulama | `npm run build`, `npm run lint`, Playwright screenshot kontrolü |

Önemli dosyalar:

- `src/App.tsx`
- `server.ts`
- `src/lib/storage.ts`
- `src/components/3d/ParticleCore.tsx`
- `src/components/views/KnowledgeMapView.tsx`
- `src/config/assistantProfiles.json`

## 3. Ana Ekranlar

### Dashboard / Sohbet

Ana deneyim ekranıdır. Ortada 3D AI çekirdeği, sağda sohbet paneli, altta sesli/metin giriş çubuğu bulunur.

Özellikler:

- AI durumu gösterimi: idle, listening, thinking, speaking, error
- Streaming chat cevapları
- Sesli giriş
- Otomatik seslendirme
- Mesaj kopyalama ve sesli okutma
- Ollama bağlantı uyarısı

### Kod Chat

Normal sohbet geçmişinden ayrı tutulan kod odaklı chat ekranıdır.

Özellikler:

- Ayrı chat session
- Kod bloklarını ayırıp biçimli gösterme
- Kopyalama
- Hızlı prompt butonları
- Daha düşük temperature ile kod odaklı sistem prompt'u

### Bellek

Kullanıcıya ait kalıcı bilgilerin tutulduğu paneldir.

Bellek kategorileri:

- Kullanıcı tercihi
- Gerçek / bilgi
- Özet
- Özel kayıt

Veriler localStorage içinde saklanır.

### Knowledge Map

Bellek, araçlar, görevler ve audit logları arasındaki ilişkileri grafik olarak gösterir.

Güncel tasarım özellikleri:

- Tema uyumlu grid ve ışık arka planı
- Kavisli bağlantı çizgileri
- Core, Memory, Tools, Tasks ve Audit hub node'ları
- Seçili node odak halkası
- Sağ panelde arama
- Metrik kartları
- Seçili node inspector'ı
- Node tipleri legend'ı
- Son aktivite paneli
- Küçük node etiketlerinde kalabalığı azaltan gösterim

### Otomasyonlar

Yerel araçların listelendiği, çalıştırıldığı ve loglarının takip edildiği ekrandır.

Örnek araçlar:

- Yerel klasör listeleme
- Metin dosyası okuma
- Sohbeti Markdown olarak dışa aktarma
- Hatırlatıcı oluşturma
- Sistem analitik özeti
- Web araması
- Sistem durumu izleme
- Tarayıcı açma
- AI skill kataloğu
- Browser / computer control placeholder araçları

### EDITH Ops

EDITH registry, audit ve operasyon katmanını izlemeye yönelik ekrandır.

### Entegrasyonlar

Harici servis bağlantı ayarlarının tutulduğu paneldir. Entegrasyon bilgileri localStorage üzerinden saklanır.

### Ayarlar

Model ve kullanıcı ayarları bu ekrandan yönetilir.

Ayar başlıkları:

- AI provider
- Ollama URL
- Seçili model
- Temperature
- Sistem prompt'u
- STT / TTS ayarları
- Persona / tema seçimi
- Auto speech
- Hands-free mode
- Memory enabled
- Animasyon kalitesi

## 4. AI ve Sohbet Akışı

Backend tarafında ana chat endpoint'i:

```text
POST /api/chat
```

Akış:

1. Kullanıcının son mesajı alınır.
2. Mesaj tool niyeti taşıyor mu diye kontrol edilir.
3. Görev oluşturma, sistem durumu, web araması veya tarayıcı açma gibi niyetler EDITH tool registry'ye yönlendirilir.
4. Normal sohbetse önce Ollama denenir.
5. Ollama ulaşılamazsa Gemini fallback denenir.
6. Gemini yoksa mock yerel cevap motoru devreye girer.

Desteklenen provider'lar:

- `ollama`
- `gemini`
- `mock`

## 5. Backend Endpoint Envanteri

`server.ts` içinde bulunan endpoint'ler:

| Endpoint | Amaç |
|---|---|
| `POST /api/voice/tts` | TTS ses üretimi |
| `GET /api/health` | Ollama ve sistem bağlantı kontrolü |
| `GET /api/edith/tools` | Registry araçlarını listeleme |
| `GET /api/edith/skill-catalog` | AI skill katalog verisi |
| `GET /api/edith/audit` | Audit event okuma |
| `GET /api/edith/tasks` | EDITH task listesi |
| `POST /api/edith/tasks` | Yeni task oluşturma |
| `PATCH /api/edith/tasks/:id/status` | Task durum güncelleme |
| `GET /api/ollama/models` | Ollama model listesi |
| `POST /api/chat` | Chat streaming endpoint'i |
| `POST /api/tools/execute` | Tool çalıştırma endpoint'i |
| `GET *` | SPA fallback |

## 6. Ses Sistemi

Ses sistemi `VoiceBar` bileşeni ve backend TTS endpoint'i üzerinden çalışır.

Özellikler:

- Web Speech API ile Türkçe canlı transkript
- Mikrofon destek algılama
- Hands-free / Auto Listen modu
- Canlı transcript bandı
- Mikrofon hata mesajları
- Yanıtı durdurma
- Browser Speech Synthesis ile TTS
- `/api/voice/tts` üzerinden harici TTS desteği

## 7. 3D AI Çekirdeği

`ParticleCore.tsx`, Three.js ile çalışan ana görsel çekirdektir.

Özellikler:

- Parçacık tabanlı 3D çekirdek
- AI durumuna göre renk ve hareket değişimi
- Web Audio analyser ile ses frekansına duyarlı hareket
- FPS ölçümü
- Performans düşünce parçacık sayısını azaltma
- Mouse wheel zoom
- Pointer drag ile döndürme
- Persona renklerine göre tema uyumu

Son düzeltme:

- HOMER temasında görülen beyaz/lila patlama ve kırpılma bug'ı düzeltildi.
- Sabit lila glow texture kaldırıldı.
- Parçacık glow'u aktif tema renginden üretilmeye başlandı.
- Açık temalarda parlaklık, particle size, ölçek ve kamera mesafesi dengelendi.

## 8. Persona ve Tema Sistemi

Tema profilleri `src/config/assistantProfiles.json` içinde tanımlıdır.

Mevcut personlar:

| ID | İsim | Tema |
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

Bu değişkenler ana UI renklerinin tek kaynaktan yönetilmesini sağlar.

## 9. Tool ve Otomasyon Sistemi

Frontend tarafında tool metadata'ları `DEFAULT_TOOLS` içinde tutulur. Backend tarafında ise EDITH tool registry bulunur.

Backend registry özellikleri:

- Tool metadata
- Input/output schema
- Permission listesi
- Risk level
- Timeout
- Dry-run desteği
- Audit event üretimi
- High-risk tool gate

Önemli registry araçları:

- `system_monitor`
- `task_create`
- `browser_open`
- `browser_search`
- `ai_skill_catalog`
- `browser_use_agent`
- `playwright_browser_agent`
- `open_interpreter_agent`
- `computer_control_agent`

Yüksek riskli araçlar varsayılan olarak kapalıdır. Bunlar yalnızca server şu env ile başlatılırsa çalışabilir:

```bash
EDITH_ENABLE_HIGH_RISK_TOOLS=true
```

## 10. Görev ve Audit Altyapısı

EDITH core içinde typed task modeli vardır.

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

Audit altyapısı tool çalıştırmalarını kaydeder:

- Actor
- Tool ID
- Authorization
- Risk level
- Result
- Message
- Timestamp

## 11. Veri Saklama

Frontend localStorage anahtarları:

| Anahtar | İçerik |
|---|---|
| `aura_settings_v1` | Kullanıcı ayarları |
| `aura_chat_sessions_v1` | Sohbet oturumları |
| `aura_active_session_id_v1` | Aktif sohbet ID |
| `aura_code_chat_session_v1` | Kod chat oturumu |
| `aura_memories_v1` | Bellek kayıtları |
| `aura_tool_logs_v1` | Tool çalışma logları |
| `aura_integrations_v1` | Entegrasyon ayarları |

Backend tarafında:

- `.edith/tasks.json`
- Audit JSONL kayıtları

## 12. Workspace İçindeki Diğer Sistemler

### Mark-L-main

Python tabanlı ayrı bir asistan sistemidir.

Öne çıkan tarafları:

- Gemini Live voice assistant
- OS action modülleri
- Browser kontrol modülleri
- Screen processing
- File actions
- Reminder/proactive modules
- PyQt UI
- Dashboard server

Bu sistem AURA ile tam birleşik değildir; ileride adapter ile bağlanabilir.

### crypto

Paper-trading odaklı ayrı bir ajan sistemidir.

Öne çıkan tarafları:

- Market data
- Technical analysis
- Risk management
- Paper trading engine
- Ollama decision engine
- SQLite state
- Flask dashboard

Canlı trading sistemi değildir; paper-trading olarak kalması güvenli yaklaşımdır.

## 13. Bu Sohbette Yapılan Değişiklikler

### Tema Rengi Düzeltmeleri

Seçili persona rengi UI'ın daha fazla yerine yayıldı.

Değiştirilen alanlar:

- Sol logo
- Sidebar aktif menü
- Sidebar ikonları
- Chat panel bot/user avatarları
- Chat balon border/shadow renkleri
- Chat header ikonu
- VoiceBar input focus
- VoiceBar gönder butonu
- VoiceBar dinleme göstergeleri
- Code Chat ana ikonları ve butonları
- Header test ikonu

### Arka Plan Sedef Denemesi

Dashboard arka planına seçili temaya göre sedef efekt eklendi. Kullanıcı isteğiyle sonradan geri alındı.

### 3D AI Çekirdeği Bug Fix

HOMER temasında ortadaki AI görünümü bozuk görünüyordu.

Düzeltmeler:

- Sabit lila glow kaldırıldı.
- Glow texture tema renklerinden üretilmeye başladı.
- Açık temalarda parlaklık düşürüldü.
- Çekirdek ölçeği ve kamera mesafesi düzeltildi.
- Wheel zoom alt limiti yükseltildi.

### Knowledge Map Yenileme

Knowledge Map tasarımı tamamen yenilendi.

Yeni tasarım:

- Daha şık header
- Tema uyumlu grid
- Kavisli bağlantılar
- Hub node sistemi
- Sağ inspector paneli
- Arama
- Metrik kartları
- Node tipleri legend'ı
- Son aktivite
- Kalabalık etiketleri azaltan node label davranışı

## 14. Doğrulama Durumu

Son doğrulamalar:

```bash
npm run build
npm run lint
```

İkisi de başarılı geçti.

Ek olarak Playwright ile şu görsel kontroller yapıldı:

- Dashboard tema render kontrolü
- HOMER 3D çekirdek kontrolü
- Knowledge Map render kontrolü

## 15. Güçlü Yanlar

- Yerel-first AI deneyimi
- Ollama entegrasyonu
- Gemini fallback
- Futuristik ve tema tabanlı UI
- 3D parçacık çekirdeği
- Sesli kullanım
- Ayrı kod chat
- Kişisel bellek
- Tool registry başlangıcı
- Görev ve audit modelinin temeli
- Knowledge Map ile sistem içgörüsü
- Tauri paketleme potansiyeli

## 16. Riskler ve Eksikler

- Workspace git repo değil; değişiklik takibi zayıf.
- `node_modules` proje klasöründe olduğu için aramalar çok gürültülü.
- Frontend `DEFAULT_TOOLS` ile backend registry henüz tamamen tek kaynak değil.
- LocalStorage hassas veri için ideal güvenli depolama değildir.
- Task/audit altyapısı var ama SQLite gibi daha sağlam bir persistence'a taşınmalı.
- High-risk browser/computer tools doğru şekilde kapalı ama ileride açılırsa daha sıkı izin sistemi gerekir.
- Mark-L, crypto ve AURA tek bir birleşik core altında tam entegre değil.
- README bazı eski mor/neon açıklamaları içeriyor; yeni tema sistemiyle güncellenebilir.

## 17. Önerilen Sonraki Adımlar

1. Projeyi git repository olarak başlatmak veya mevcut repo ile bağlamak.
2. Frontend tool metadata ve backend EDITH registry'yi tek kaynakta birleştirmek.
3. Task, audit, tool run ve memory kayıtlarını SQLite'a taşımak.
4. Sensitive memory için ayrı güvenli depolama stratejisi eklemek.
5. Mark-L araçlarını doğrudan değil, permission-gated adapter üzerinden bağlamak.
6. Crypto sistemini önce read-only dashboard/status olarak entegre etmek.
7. Settings ve Memory ekranlarındaki kalan sabit mor focus renklerini tema değişkenlerine taşımak.
8. README ve mimari dokümanları yeni UI/tema/Knowledge Map durumuna göre güncellemek.

## 18. Genel Sonuç

Proje şu an yerel AI asistan dashboard'u olarak güçlü bir temel seviyeye gelmiş durumda. Chat, ses, tema, 3D çekirdek, bellek, otomasyon, görev/audit, Knowledge Map ve entegrasyon ekranları mevcut. En büyük mimari kazanım, EDITH core/registry/task/audit modelinin başlamış olmasıdır.

Bir sonraki ciddi kalite sıçraması, veriyi localStorage/JSON dosyalarından daha sağlam bir local database katmanına taşımak ve bütün tool sistemini tek backend-enforced registry üzerinden yönetmek olacaktır.
