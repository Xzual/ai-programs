# Yapay Zeka Mevcut Durum Raporu

Tarih: 2026-08-11
Proje: Autonomous Crypto Trading Agent

## 1. Kısa Özet

Bu projede mevcut yapay zeka, “kripto piyasasını izleyen, teknik analiz yapan, haberleri değerlendiren, LLM tabanlı karar üreten ve sanal alım-satım gerçekleştiren” bir otonom trading ajanı olarak çalışmaktadır. 

Şu anda yapay zeka temel olarak aşağıdaki işleri yapıyor:

- Piyasa verisini topluyor
- Teknik analiz yapıyor
- Haberleri bir araya getiriyor
- LLM’ye karar vermesi için bağlam sunuyor
- Risk kurallarına göre işlemi onaylıyor veya red ediyor
- Sanal(portföy) işlemler gerçekleştiriyor
- İşlem sonuçlarını hafızaya kaydediyor ve gelecekteki kararları iyileştirmeye çalışıyor

Bu nedenle proje şu aşamada “tam anlamıyla kendi kendine öğrenen bir sistem” değil; daha çok “karar destek + paper trading + hafıza tabanlı ajan” seviyesindedir.

---

## 2. AI Nedir ve Ne Yapıyor?

Bu proje içindeki AI, tek bir büyük LLM mantığıyla değil; birkaç bileşenin birlikte çalışmasıyla oluşan bir sistemdir.

Ana mantık şu şekildedir:

1. Piyasa verisi toplanır
2. Teknik analiz yapılır
3. Haberler alınır
4. LLM’ye bir karar verme isteği gönderilir
5. Risk yönetimi kararın uygulanabilirliğini kontrol eder
6. Karar sanal olarak yürütülür
7. Sonuç hafızaya kaydedilir

Bu yüzden burada “AI” aslında bir “agent orkestrasyonu” olarak çalışmaktadır.

---

## 3. Mevcut Akış: AI Nasıl Çalışıyor?

### 3.1. Döngü Başlatma

Agent her döngüde aşağıdaki adımları sırayla yürütür:

- Haberleri toplar
- İzleme listesindeki sembolleri işler
- Her sembol için fiyat verisini çeker
- Teknik analiz yapar
- LLM’e karar vermesi için veri gönderir
- Risk kurallarını kontrol eder
- İstenirse sanal işlem yapar
- Sonucu hafızaya kaydeder

Bu döngü, ana orkestratör olan agent.py içinde yönetilmektedir.

### 3.2. Piyasa İzleme

AI şu anda kripto piyasasını Binance üzerinden izlemektedir. 

İzlenen semboller arasında şunlar bulunur:

- BTC/USDT
- ETH/USDT
- SOL/USDT
- BNB/USDT
- XRP/USDT
- DOGE/USDT
- ADA/USDT
- AVAX/USDT

Bu aşamada AI, fiyat hareketlerini ve zaman serisi verisini takip ederek bir “durum çıkarımı” yapmaktadır.

### 3.3. Teknik Analiz Yapma

AI, fiyat verilerine dayanarak teknik göstergeler üretmektedir. Şu göstergeler hesaplanır:

- RSI
- MACD
- EMA (kısa ve uzun)
- Bollinger Bands
- ATR
- VWAP

Bu analizler, AI’nın alım-satım kararının temelini oluşturmaktadır.

### 3.4. Haber Toplama

AI, haberleri RSS beslemelerinden toplamaktadır. Şu kaynaklar kullanılmaktadır:

- CoinDesk
- CoinTelegraph

Bu haber verileri, LLM’e “temel duyarlılık” ve “piyasa bağlamı” sağlamak amacıyla aktarılmaktadır.

### 3.5. LLM ile Karar Verme

Bu projede AI’nın “zeka kısmı” aslında LLM’dir. 

Sistem şunları yapar:

- Teknik veriyi hazırlar
- Haberleri ekler
- Portföy durumunu sunar
- Geçmiş kararları verir
- Ollama’ya bir prompt gönderir
- Cevap olarak JSON formatında BUY / SELL / HOLD kararı alır

Bu kararın içinde genelde şunlar bulunur:

- action: BUY / SELL / HOLD
- confidence: güven skoru
- reasoning: kararın açıklaması
- expected_move: kısa vadeli beklenti

Bu nedenle şuan AI’nın “karar verme” tarafı LLM tabanlıdır.

### 3.6. Risk Yönetimi

LLM kararı verildikten sonra bu karar risk yönetimi tarafından kontrol edilir. 

Risk yönetimi şu kuralları uygular:

- Açık pozisyon sınırı
- Pozisyon büyüklüğü limiti
- Stop-loss seviyesi
- Take-profit seviyesi
- Zaten aynı sembolde pozisyon varsa işlem yapmama

Yani AI bir karar üretebilir ama gerçek işlem risk modülü tarafından durdurulabilir. Bu, sistemi daha güvenli hale getirir.

### 3.7. Sanal İşlem Gerçekleştirme

Bu proje paper trading modunda çalışmaktadır. Yani AI gerçekten para kullanmaz; sadece sanal portföy üzerinde işlem yapar.

Sistem şu adımları uygular:

- Alım gerçekleştirir
- Satış gerçekleştirir
- Portföy bakiyesini günceller
- Açık pozisyonları saklar
- Kâr/zarar hesaplar

Bu aşama aslında “AI’nin eyleme geçtiği” kısmıdır.

### 3.8. Öğrenme ve Hafıza

AI, işlem sonuçlarını hafızaya kaydetmektedir. 

Saklanan veriler şunlardır:

- Piyasa anlık görüntüleri
- Alınan kararlar
- Gerçekleştirilen işlemler
- Portföy durumu
- İşlem analizleri

Bunun sayesinde sistem geçmişteki işlemlere göre bir değerlendirme yapmaya çalışır. Ancak bu öğrenme düzeyi, klasik bir ML eğitimi kadar derin değildir. Daha çok “geçmiş karar ve sonuçları hatırlama + analitik geri bildirim” seviyesindedir.

---

## 4. Bu Aşamada AI “Ne Seviyede” Çalışıyor?

Bu proje şu aşamada aşağıdaki seviyede çalışmaktadır:

### 4.1. Düzey: Karar Destekli Otonom Ajan

AI şu anda daha çok şunları yapıyor:

- Piyasa verisini okuyor
- Teknik sinyaller üretiyor
- Haberleri değerlendiriyor
- Bir karar veriyor
- Bu kararı sanal ortamda test ediyor

Bu yüzden mevcut seviyeye göre AI, “tam otonom yatırımcı” değil; “kurallara bağlı, LLM destekli, paper trading yapan bir ajan”dır.

### 4.2. Düzey: Kendi Kendine Geri Bildirim Veren Sistem

İşlem sonuçları analiz edildiğinde sistem bir “ders çıkarma” sürecine girer. Yani:

- İşlem başarılı mı başarısız mı oldu?
- Neden böyle oldu?
- Gelecekte bu konuda ne değiştirilmeli?

Bu, AI’nın “öğrenmeye çalıştığı” bir kısımdır. Ancak bu öğrenme, yapay sinir ağı eğitimi gibi değil; daha çok LLM tabanlı yorumlama ve hafıza kayıtçılığı şeklindedir.

---

## 5. Mevcut Güçlü Yönler

Bu sistemin güçlü yönleri şunlardır:

- Modüler yapıdadır
- Piyasa verisi, haber, teknik analiz ve risk yönetimini birleştirir
- Paper trading ile güvenli şekilde test edilebilir
- SQLite hafıza ile geçmiş kararları saklar
- LLM tabanlı karar verme sunar
- Dashboard üzerinden izlenebilir

---

## 6. Mevcut Zayıf Yönler / Sınırlamalar

Bu proje şu an daha çok bir “prototip ve araştırma sistemi” şeklindedir. Sınırlamaları şunlardır:

- LLM’e bağlıdır; model erişimi kesilirse karar üretimi zayıflar
- Gerçek borsa ile doğrudan entegre değildir
- Sadece sanal para ile çalışır
- Öğrenme mekanizması derin değildir
- Karar kalitesi, LLM’nin yorumuna ve gelen verinin kalitesine bağlıdır
- Teknik analiz sadece belirli göstergelerle sınırlıdır

---

## 7. Sonuç

Bu projede yapay zeka şu aşamada şunları yapmaktadır:

- Piyasayı takip eder
- Teknik analiz yapar
- Haberleri toplar
- LLM ile BUY / SELL / HOLD kararı üretir
- Risk kontrolü uygular
- Sanal işlemler gerçekleştirir
- İşlem sonuçlarını kaydeder
- Geçmişe dayanarak bir öğrenme/analiz çabası gösterir

Özetle: bu proje şu aşamada “LLM destekli, risk kontrollü, paper trading çalışan bir otonom kripto ajan”dır.

Bu sistemin bir sonraki evresi şu olabilir:

- daha güçlü strateji öğrenme
- daha iyi geçmiş veri analizi
- daha zengin sinyal kombinasyonları
- gerçek borsa entegrasyonu
- daha güçlü otomatik optimizasyon

---

## 8. Kısa Sonuç Cümlesi

“AI şu anda piyasayı izleyen, analiz eden, LLM ile karar veren, risk kontrolü yapan ve sanal işlemler gerçekleştiren bir trading ajanı rolü üstlenmektedir.”
