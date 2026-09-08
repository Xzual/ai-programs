# E.D.I.T.H. dev testi — 8 Eylül 2026

Durum: **Ön rapor; kullanıcı arayüzü kabul testi henüz tamamlanmadı.** Masaüstü uygulaması isimle etkinleştirme ekranında bekliyor. Giriş sonrası ekranları ve butonları kullanılmadan başarılı saymak mümkün değil.

## Ortam ve kapsam

- Windows, Node.js v22.22.3, Vite v6.4.3, Tauri debug uygulaması.
- Başlatma: `npm run tauri:dev`. Express 3000, Vite 5173, Ollama 11434.
- `target/debug/edith.exe` başarıyla çalıştı; başlangıç ekranı gerçek masaüstü penceresinde incelendi.
- Depoda önceden değişmiş ve izlenmeyen dosyalar mevcut. Test bu çalışma ağacına uygulandı; kaynak kodda düzeltme yapılmadı.
- `npm run build` çalıştırıldığı için dist çıktıları yeniden üretildi. API sohbet denemesi uygulamanın normal çalışma kayıtlarını oluşturmuş olabilir.
- Test edilen HTTP istekleri doğrudan yerel API üzerinden gönderildi. Bunlar arayüzde mesaj gönderme, model seçme veya buton tıklama testinin yerine geçmez.

## Sonuç tablosu

| Kontrol | Sonuç | Kanıt / sınır |
|---|---|---|
| Tauri dev başlatma | Başarılı | Rust dev profili tamamlandı; EDITH penceresi açıldı. |
| Web ve sunucu build | Başarılı | Vite 1692 modülü işledi; esbuild server.cjs oluşturdu. Tauri kurulum paketi testi değildir. |
| TypeScript kontrolü | Başarısız | `npm run lint`, 8 adet TS2339 hatası, exit 1. |
| Ollama model keşfi | Başarılı | `/api/tags`, qwen2.5:3b dahil modelleri döndürdü. |
| Sistem sağlık API | Başarılı HTTP yanıtı | `/api/status`: 200; backend online, Ollama available. Her entegrasyonun çalıştığı anlamına gelmez. |
| Provider sağlık API | Başarılı | `/api/providers/health`: 200, Ollama healthy. |
| Model API | Başarılı | `/api/models?provider=ollama`: 200, qwen2.5:3b listede. |
| Gerçek qwen2.5:3b sohbeti | Başarılı | `/api/chat`: 200 SSE, streaming ve completed olayları, fallbackUsed=false. |
| Provider regresyon testi | Başarılı | `npm run test:edith-providers`, exit 0. Bu testin bazı senaryoları kontrollü test servisleri kullanır. |
| Etkileşim güvenliği testi | Başarısız | `npm run test:edith-interaction-safety`, satır 60: undefined != BLOCKED. |
| Başlangıç tarayıcı konsolu | Küçük hata | GET /favicon.ico 404. İncelenen anda başka görünür konsol hatası yoktu. |
| Terminal | Başlangıçta çökme yok | SQLite ExperimentalWarning var; test süresince dev sunucusu açık kaldı. |

## Doğrulanmış sorunlar

### QA-01 — Tarayıcı yetenekleri ile etkileşim güvenliği veri sözleşmesi uyumsuz

Öncelik: **P1 — geliştirme doğrulamasını ve güvenlik durum raporlamasını düzeltme önceliği.** Bu bulgu tek başına bir izin atlatma açığını kanıtlamaz.

Tekrarlama:

1. `npm run lint` çalıştır.
2. `npm run test:edith-interaction-safety` çalıştır.
3. `/api/edith/interaction-safety` yanıtındaki browser_workflow sınıflandırmalarını incele.

Beklenen: Tarayıcı yetenekleri runtimeStatus, riskLevel, requiredPermissions ve requiresApproval alanları ile tutarlı biçimde raporlanmalı; tip kontrolü ve test geçmeli.

Gerçekleşen:

- `BrowserWorkflowCapability` bu dört alanı tanımlamıyor; capabilities() nesneleri de bu alanları üretmiyor.
- `src/edith/interactionSafetyService.ts:172,174,175,177` bu alanları okuyor. runtimeStatus aynı satırda iki kez okunduğundan burada 5 TypeScript hatası var.
- `scripts/test-edith-interaction-safety.ts:60,61,62` içinde 3 ek TypeScript hatası var.
- Çalıştırılan test satır 60'ta beklenen BLOCKED yerine undefined aldığı için duruyor; sonraki test iddiaları yürütülmedi.
- Canlı HTTP yanıtında tarayıcı sınıflandırmaları blocked görünüyor, riskLevel ve requiredPermissions alanları JSON'da bulunmuyor. requiresApproval undefined olduğu için onay gerektiğini söyleyen dal seçilmiyor.

Etki: Güvenlik/yetenek durumunu tüketen ekranlar eksik veya yanıltıcı bilgi alabilir. İlgili ekran giriş sonrası gözlenmedi; ekranda tam olarak nasıl göründüğü henüz doğrulanmadı.

Öneri: BrowserWorkflowService ile InteractionSafetyService veri sözleşmesini eşitle; alanları gerçek çalışma/izin durumlarından üret. Ardından iki başarısız kontrolü tekrar çalıştır ve ilgili ekranı test et.

### QA-02 — Eksik favicon nedeniyle başlangıçta 404

Öncelik: **P3 — düşük.**

Tekrarlama: Tauri dev açılışında DevTools Console'u incele.

Gerçekleşen: `GET http://localhost:5173/favicon.ico 404 (Not Found)`.

Etki: Konsola gereksiz hata düşüyor; gözlenen başlangıç ekranını engellemedi. Sohbet API hatası değil.

Öneri: Geçerli favicon ekle veya HTML içinde mevcut ikon yolunu belirt.

## Gerçek model testi

İstek: provider=ollama, model=qwen2.5:3b, memoryEnabled=false, userName=QA Test.

Mesaj: “Bu bir uygulama testidir. 17 + 25 kaç eder? Tek cümle Türkçe cevap ver.”

Yanıt parçalarının birleşimi: “Efendim,42 eder.”

- İstemci tarafından ölçülen toplam süre: 4,416 saniye.
- Son SSE olayındaki latencyMs: 2290. Bu değer istemci toplam süresiyle aynı ölçüm değildir.
- resolvedProvider=ollama; resolvedModel=qwen2.5:3b; fallbackUsed=false.
- done=true ile tamamlandı; boş yanıt veya provider hatası görülmedi.
- Tek kısa istek başarıyla geçti; uzun konuşma, iptal, eşzamanlı istek ve arayüz akışı henüz test edilmedi.

## Yapılandırma gözlemleri — doğrudan yazılım hatası sayılmadı

- Gemini: `configuration_required`, GEMINI_API_KEY tanımlı değil. Bulut yanıtı denenmedi.
- Crypto: offline, autostart=false, observerRunning=false. Tauri başlatma betiği crypto autostart'ı kapalı başlatıyor. Bu gözlem tek başına crypto uygulamasının bozuk olduğunu göstermez.
- Crypto kapalıyken durum mesajı “agent başlatılıyor olabilir” diyor; managedProcessRunning=false olduğunda daha açık bir kapalı servis mesajı tercih edilebilir.
- Obsidian durum API'si connected/readable/writable bildirdi; gerçek not ekleme veya senkronizasyon denenmedi.
- Ollama'nın raporlanan varsayılan modeli qwen3.5:0.8b. qwen2.5:3b API isteğinde açıkça seçildi. Masaüstü arayüzünün seçili modeli henüz görülmedi.
- Debug açılışında DevTools otomatik açılarak başlangıç ekranının bir bölümünü kapladı; sonra simge durumuna küçültüldü. Dev akışında gözlenen davranış; dağıtım sürümü hakkında çıkarım yapılmadı.

## Tamamlanması gereken kullanıcı senaryoları

Etkinleştirme sonrasında: menüler ve sayfa geçişleri; UI'da qwen2.5:3b seçimi; mesaj gönderme, streaming ve durdurma; sohbet geçmişi; ayarlar ve kalıcılık; bellek ekleme/arama; araç arama ve çalıştırma geri bildirimi; bilgi haritası; entegrasyonların kapalı servis durumları; 3D stüdyo; proaktif ekran; pencere boyutları ve kaydırma. Her senaryo sırasında konsol, ağ ve terminal kontrolü yapılmalı.

Ses tanıma ve mikrofonla gerçek kullanım ayrıca kullanıcı girdisi gerektirir. Dış servislerde mesaj gönderme, gerçek finansal işlem ve mevcut kullanıcı verisini silme bu testte gerçekleştirilmedi.

**Sonuç:** Başlatma, build ve kısa gerçek Ollama sohbeti çalışıyor; tip kontrolü ve etkileşim güvenliği testi kırık. Giriş sonrası kullanıcı testi tamamlanmadığı için programın tüm butonlarının çalıştığı veya genel kullanıma hazır olduğu söylenemez.
