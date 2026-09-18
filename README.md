# E.D.I.T.H.

E.D.I.T.H. (Enhanced Digital Intelligence & Tactical Helper), yerel bilgisayarda calisan bir kisisel AI isletim sistemi projesidir. React 19 arayuzu, Express API, Tauri masaustu kabugu ve Three.js gorsellestirmelerini bir araya getirir. Sohbet, ses, gorevler, bellek, Obsidian bilgi grafigi ve araclar tek arayuzde bulunur. Proje aktif gelistirme asamasindadir; bazi ekranlar calisan entegrasyon, bazilari ise guvenlik kontrollu altyapi sunar.

## Mevcut Ozellikler

| Alan | Bugunku durum |
| --- | --- |
| AI saglayicilari | Backend kaydinda Ollama, Google Gemini ve durumu acikca belirtilen EDITH Mock bulunur. Otomatik yonlendirme saglikli yerel Ollama'yi once dener; fallback bilgisi sohbet yanitina eklenir. |
| Sohbet ve persona | Akisli sohbet, model/saglayici secimi, sohbet gecmisi ve asistan profilleri vardir. Persona secimi model seciminden ayridir. |
| Ses | Tarayici konusma destegi ve Gemini Live icin backend WebSocket, mikrofon PCM akisi, transkript, ses cikisi ve kesme akisi bulunur. Canli ses API anahtarina, model erisimine ve mikrofon iznine baglidir. Wake word yoktur. |
| Bellek ve bilgi | Kalici gorev/bellek kayitlari, Obsidian Markdown/Canvas indeksleme, gercek kayitlardan olusan bilgi grafigi ve metin tabanli RAG aramasi bulunur. Embedding saglayicisi yoksa vektor aramasi yapildigi iddia edilmez. |
| Gorev ve ajan altyapisi | Gorev servisi/kuyrugu, planlayici, executor, verifier, recovery, ajan kaydi, yetenek degerlendirmesi ve arac kaydi bulunur. Bir yetenegin kayitli olmasi tum dis islemleri otomatik yaptigi anlamina gelmez. |
| Guvenlik | Izin politikalari, risk siniflandirmasi, audit kayitlari ve kill switch vardir. Computer Use ve Browser ekranlari mevcut sinirlari gosterir. |
| Masaustu | Tauri 2 kabugu, ozel baslik cubugu ve pencere komutlari mevcuttur. Tarayici modu Tauri olmadan da calisir. |
| Arayuz | 3D parcacik cekirdegi, bilgi grafigi, dashboard, kod sohbeti, 3D studio, entegrasyon ve sistem gorunumleri bulunur. |
| Kripto | Ayri Python servisi ve arayuzde izleme baglantisi bulunur. Baslatma betikleri `OBSERVER_ONLY` modunu zorlar; canli alim/satim bu akisin parcasi degildir. |

### Su anki sinirlar

- Bilgisayarda fare/klavye eylemlerini gerceklestiren yerel runtime adaptoru bagli degildir; Computer Use varsayilan olarak `READ_ONLY` durumundadir. Gercek ekran goruntusu/OCR ve sinirsiz masaustu kontrolu tamamlanmis ozellikler degildir.
- Saglayici kaydinda OpenAI, Anthropic veya OpenRouter backend adaptoru yoktur. Arayuzde gorunen bir API anahtari alani, anahtarin etkinlestirildigi anlamina gelmez. Gemini icin calisan yapilandirma yolu backend `.env` dosyasidir.
- Tauri paketinde Express sunucusunun otomatik paketlenip baslatildigi bir sidecar yoktur. `tauri:dev` gelistirme icin API ve Vite sureclerini baslatir; dagitilabilir masaustu paketinin API bagimliligi ayri dogrulanmalidir.

## Hizli Baslangic

Gereksinimler: Node.js ve npm. Yerel model icin [Ollama](https://ollama.com/download) istege baglidir. Tauri icin Rust/Cargo ve platformun Tauri 2 gelistirme gereksinimleri gerekir.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Arayuz ve API varsayilan olarak [http://localhost:3000](http://localhost:3000) adresindedir. `.env` kopyalama adimi istege baglidir; bulut Gemini veya Obsidian gibi ozellikleri yapilandiracaksaniz gereklidir. Gercek anahtarlari `.env.example` icine yazmayin.

Sadece Vite arayuzunu baslatan `npm run vite:dev` komutu `http://localhost:5173` adresini kullanir ve `/api` isteklerini `http://localhost:3000` adresine yonlendirir. Bu modda API icin ayrica `npm run dev` calismalidir.

### Yerel Ollama

Ollama'yi kurup kendi servisini baslatin ve bir model indirin. Ornek:

```powershell
ollama pull llama3.2
```

Varsayilan adres `http://localhost:11434` (`OLLAMA_HOST`) olarak ayarlidir. E.D.I.T.H. Ollama'yi kendi baslatmaz. Model ve saglayici durumunu arayuzden ya da `GET /api/providers/health` ve `GET /api/models` ile kontrol edebilirsiniz. Ollama cevrimdisiyken uygulama acilmaya devam eder; Mock kullanilirsa yanit bunun fallback oldugunu bildirir.

### Gemini

Proje kokundeki `.env` dosyasina anahtari ekleyin:

```dotenv
GEMINI_API_KEY=your_real_key_here
GEMINI_DEFAULT_MODEL=gemini-3.6-flash
```

Sunucuyu yeniden baslatin ve `GET /api/providers/health` ile durumu kontrol edin. Normal metin sohbetinin varsayilan Gemini modeli `gemini-3.6-flash`; canli sesin ayri modeli `gemini-3.1-flash-live-preview` ve ayri Gemini Live baglantisidir. Model erisimi hesaba/bolgeye baglidir. `gemini-2.5-flash` bu projede varsayilan degildir. Anahtar frontend depolamasina konmamalidir; mevcut ayarlar ekranindaki API key formu anahtari kaydetmez.

## Calistirma ve Build

| Komut | Islev |
| --- | --- |
| `npm run dev` | Express API ve Vite middleware ile tarayici gelistirme sunucusu, port 3000. |
| `npm run edith:dev:safe` | Kripto otomatik baslatmasi kapali tarayici gelistirme. |
| `npm run edith:dev:full` | Ana sunucuyu ve varsa kripto gozlemcisini baslatir; kripto icin observer-only bayraklarini zorlar. |
| `npm run services:status` | Yerel servislerin durumunu sorgular. |
| `npm run tauri:dev` | Cargo on kontrolunden sonra Tauri gelistirmeyi; API'yi 3000, Vite'i 5173 portunda calistirir. |
| `npm run lint` | TypeScript tip kontrolu (`tsc --noEmit`). |
| `npm run build` | Vite frontend ve Express sunucu bundle'i olusturur. |
| `npm start` | Derlenmis `dist/server.cjs` dosyasini baslatir; once `npm run build` gerekir. |
| `npm run tauri:build` | Tauri paketi olusturmayi dener; Rust ve platform paketleme gereksinimleri gerekir. |

Windows'ta Cargo `PATH` icinde gorunmese bile `tauri:dev` on kontrolu `where.exe cargo`, `Path`/`PATH` ve kullanici Cargo dizinlerini dener; buldugu yolu terminale yazar. Tauri paketleme baska platformlarda gerekli ikon/dosya ve bagimliliklara gore ayrica kontrol edilmelidir. Tarayici gelistirmesi icin Rust gerekmez.

## Obsidian ve Yerel Veri

`.env.example` varsayilan vault yolunu `D:\EDİTH\EDİTH` olarak gosterir. Bu yol yerel makinenizde farkliysa `OBSIDIAN_VAULT_PATH` degerini kendi vault'unuza gore ayarlayin. Turkce buyuk `İ` karakteri ornek yolda bilerek kullanilmistir.

Obsidian servisi Markdown notlari, wikilinkleri, etiketleri, Canvas iliskilerini ve ekleri indeksler. Bilgi grafigi gorev, bellek, ajan, arac ve vault verilerini kullanir. Vault bulunamazsa ilgili durum raporlanir; uygulamanin diger bolumleri calismaya devam eder. Kalici backend veri deposu once SQLite'i dener, kullanilamazsa JSON depoya gecer. Arayuzdeki bazi tercihler ve oturumlar tarayici depolamasinda da tutulur.

## Proje Yapisi

```text
src/              React arayuzu ve E.D.I.T.H. cekirdek servisleri
server.ts         Express giris noktasi ve mevcut API entegrasyonlari
server/           AI provider, route ve Gemini Live ses modulleri
src-tauri/        Tauri 2 masaustu kabugu
scripts/          Baslatma, migrasyon ve odakli test betikleri
docs/             Mimari kararlar, kurulum ve durum raporlari
crypto/           Ayri kripto gozlemci / Python sistemi
Mark-L-main/      Harici Python asistan projesi
```

Temel yigin: React 19, TypeScript, Vite 6, Express 4, Tauri 2, Rust, Three.js ve `@google/genai`.

## Testler ve Belgeler

```powershell
npm run lint
npm run build
npm run test:edith-providers
npm run test:edith-voice-room
npm run test:edith-obsidian-knowledge
npm run test:edith-interaction-safety
```

Testlerin her biri bagimsiz npm betigidir; tam liste `package.json` icindedir. Yerel Gemini anahtarini gercek API'ye karsi sinamak icin `npm run smoke:gemini` ayri bir ag/hesap testi yapar; normal build icin gerekli degildir.

- [AI provider sistemi](docs/EDITH_AI_PROVIDER_SYSTEM.md)
- [Masaustu kurulumu](docs/EDITH_DESKTOP_SETUP.md)
- [Obsidian bilgi katmani](docs/EDITH_OBSIDIAN_KNOWLEDGE_INTELLIGENCE.md)
- [Baslatma yoneticisi](docs/EDITH_STARTUP_MANAGER.md)
- [Sonraki faz mimari kararlari](docs/EDITH_MASTER_ARCHITECTURE_DECISION_NEXT_PHASE.md)

## Guvenlik

Gercek API anahtarlarini yalnizca backend ortaminda tutun ve repoya eklemeyin. Izin sistemi, kill switch ve audit gunlugu riskli arac cagrilari icin mevcuttur; bir arayuzun gorunmesi o islemin yetkili veya gercek runtime'a bagli oldugu anlamina gelmez. Kripto gozlemci modunu gercek emir verme ozelligi olarak kullanmayin.
