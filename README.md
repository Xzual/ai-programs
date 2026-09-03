# E.D.I.T.H. — Yerel Öncelikli Kişisel AI İşletim Sistemi

**E.D.I.T.H.**, yerel makinenizde gizlilik odağıyla çalışan, provider/model ayrımı net, sesli etkileşimli, kişisel bellekli ve güvenli otomasyon araçlarına sahip bir kişisel AI işletim sistemi arayüzüdür.

---

## 🌟 Öne Çıkan Özellikler

1. **Futuristik 3D Parçacık Çekirdeği (Three.js / WebGL)**
   - Sistem durumuna (`idle`, `listening`, `thinking`, `speaking`, `error`) göre dinamik renk ve hareket geçişi.
   - Ses dalgasına ve ses seviyesine duyarlı Web Audio API frekans analizi.
   - Donanıma göre otomatik FPS takibi ve parçacık yoğunluğu ölçekleme.

2. **%100 Yerel LLM Entegrasyonu (Ollama)**
   - Harici bulut API'lerine bağımlı olmadan bilgisayarınızda çalışan Ollama modelleri (`llama3.2`, `qwen2.5`, `mistral`, `gemma2`).
   - Gerçek zamanlı akışlı (streaming) yanıt üretimi.
   - Bulut / Gemini API veya yerel mock motoruna tek tıkla esnek geçiş seçeneği.

3. **Sesli Konuşma Akışı (STT & TTS)**
   - Dahili Web Speech API ve yerel Whisper/Piper entegrasyon desteği.
   - Mikrofondan alınan sesin canlı transkript gösterimi.
   - AI yanıtlarının otomatik sesli okutulması ve durdurulabilmesi.

4. **Kişisel Bellek Modülü (Memory Panel)**
   - Kullanıcı tercihleri, isim, sık kullanılan diller ve önemli notların kalıcı kaydı.
   - "Bunu hatırla" ve "Bunu unut" komutları.
   - Hassas bilgi etiketleme ve gizlilik uyarısı.

5. **Güvenli Yerel Otomasyonlar & Araçlar**
   - Güvenli dosya listeleme, metin dosyası okuma, sohbeti Markdown olarak dışa aktarma, zamanlanmış bildirimler.
   - Her işlem için açık kullanıcı onayı şartı ve detaylı işlem günlüğü (audit log).

6. **Karanlık Neon Estetik & Cam Efektleri**
   - Mor, fuşya ve neon mavi tonlarıyla tasarlanmış, okunabilirliği yüksek karanlık dashboard.
   - Masaüstü (Tauri / Electron) uyumlu responsive layout.

---

## 🚀 Hızlı Kurulum ve Çalıştırma

### 1. Gereksinimler
- **Node.js**: v18.0.0 veya üzeri
- **npm**: v9.0.0 veya üzeri
- **Ollama**: (İsteğe bağlı, yerel LLM çalıştırmak için)

### 2. Proje Kurulumu

```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirici modunda çalıştırın (Port 3000)
npm run dev
```

Uygulamanız varsayılan olarak `http://localhost:3000` adresinde açılacaktır.

---

## 🦙 Ollama Kurulumu ve Model Yükleme

E.D.I.T.H.'i tamamen çevrimdışı ve yerel çalıştırmak için Ollama'yı kurun:

### 1. Ollama İndirme & Kurulum

**macOS / Linux:**
```bash
curl -fsSL https://ollama.com/install.sh
```

**Windows:**
[Ollama Windows Kurulum Dosyasını İndirin](https://ollama.com/download/windows)

### 2. Model İndirme (Tavsiye Edilen Modeller)

Donanımınıza en uygun modeli indirmek için terminalde aşağıdaki komutlardan birini çalıştırın:

```bash
# 8 GB RAM / Giriş Seviyesi (Önerilen)
ollama run llama3.2

# Türkçe & Asya dilleri için yüksek performans (8-16 GB RAM)
ollama run qwen2.5

# Dengeli Genel Amaçlı Model (16 GB RAM)
ollama run mistral
```

### 3. Ollama Sunucusunu Başlatma

Ollama servisinin tarayıcıdan gelen isteklere izin vermesi için:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

---

## 💻 Donanım ve Model Seçim Rehberi

| Donanım Özelliği | Önerilen Model | Beklenen Performans |
| :--- | :--- | :--- |
| **8 GB RAM / Dahili GPU** | `llama3.2:1b` veya `llama3.2:3b` | Akıcı sohbet, düşük bellek kullanımı |
| **16 GB RAM / GTX 1660 / RTX 3050 (4-6 GB VRAM)** | `llama3.2:latest` / `qwen2.5:7b` | Çok hızlı yanıt süresi, yüksek Türkçe başarısı |
| **32 GB+ RAM / RTX 3080+ (8 GB+ VRAM)** | `mistral:7b` / `gemma2:9b` | Üst düzey yaratıcılık ve karmaşık kodlama |

*E.D.I.T.H.'in 3D parçacık çekirdeği Ayarlar ekranından `Düşük`, `Orta` veya `Yüksek` olarak ayarlanabilir. Düşük donanımlı sistemlerde `Düşük (1.800 parçacık)` seçeneği önerilir.*

---

## 📦 Masaüstü Uygulaması Olarak Paketleme (Tauri / Electron)

E.D.I.T.H. masaüstü uygulaması olarak paketlenmeye hazır mimaridedir.

### Tauri ile Paketleme (Tavsiye Edilen - Hafif & Hızlı)

```bash
# Tauri CLI ekleyin
npm install -D @tauri-apps/cli

# Tauri projesini başlatın
npx tauri init

# Masaüstü derlemesini alın
npx tauri build
```

---

## 🛡️ Güvenlik ve Gizlilik İlkeleri

- **API Anahtarları:** E.D.I.T.H. ön yüz kodlarında API anahtarlarını saklamaz.
- **Yerel Depolama:** Tüm sohbet geçmişi ve bellek kayıtları tarayıcınızın veya masaüstü uygulamanızın yerel depolama alanında (IndexedDB/LocalStorage) saklanır.
- **İzinler:** Dosya okuma ve zamanlayıcı oluşturma gibi dış dünyada yan etkisi olan her araç çalıştırmadan önce açık kullanıcı onayı ister.

---

## 📄 Lisans

Apache-2.0 Lisansı ile lisanslanmıştır.
