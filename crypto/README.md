# E.D.I.T.H. Crypto Jev Demo Exchange

Bu servis Binance public piyasa verisi, 10.000 kredilik yerel demo portföy ve
karar-only Jev adapteri sağlar. Gerçek para, Binance private trading API veya
gerçek emir yürütme yolu içermez.

## Güvenli Faz Ayarları

```env
CRYPTO_DEMO_TRADING_ENABLED=true
CRYPTO_STARTING_BALANCE=10000
CRYPTO_DECISION_MODEL=jev
CRYPTO_OBSIDIAN_ENABLED=false
CRYPTO_LEARNING_ENABLED=false
CRYPTO_NEWS_ENABLED=false
CRYPTO_OLLAMA_ENABLED=false
CRYPTO_LIVE_TRADING_ENABLED=false
BINANCE_TRADING_ENABLED=false
```

## Jev Yapılandırması

Jev anahtarı yalnızca proje kökündeki yerel `.env` dosyasına veya process
environment'a eklenmelidir. Frontend, localStorage, Supabase, Obsidian ve repo
dosyalarına gerçek anahtar yazılmamalıdır.

```env
JEV_API_KEY=your-backend-only-key
JEV_API_URL=https://api.typesafe.ai
JEV_MODEL=jev-1.13.0
JEV_API_STYLE=typesafe
JEV_TIMEOUT_SECONDS=20
```

`typesafe` varsayılan protokoldür. Adapter base URL'ye `/v1/systemone` ekler ve
Jev'e `state` ile tek bir typed `choice` sorusu gönderir. Bu sorunun seçenekleri
yalnızca `BUY`, `SELL` ve `HOLD` değerleridir. Tam `/v1/systemone` URL'si de
doğrudan kullanılabilir. Bir gateway gerçekten OpenAI chat-completions biçimi
kullanıyorsa `JEV_API_STYLE=openai_chat`; özel compact JSON endpointi
kullanıyorsa `JEV_API_STYLE=direct` seçilebilir.

Eksik `JEV_API_KEY` durumunda servis `config_required` döndürür ve karar/trade
üretmez. `JEV_API_URL` ve `JEV_MODEL` verilmezse yukarıdaki resmi TypeSafe
varsayılanları kullanılır. Servis env değişikliğinden sonra yeniden
başlatılmalıdır.

## Jev Karar Sözleşmesi

Adapter Jev'e yalnızca sembol, fiyat, hacim, bid/ask/spread, kısa ve orta trend,
volatilite, demo pozisyonu, cash/equity ve risk izninden oluşan kompakt `state`
gönderir. Native Jev cevabı `answers.decision.choice` ve varsa
`answers.decision.confidence` üzerinden okunur. Gateway uyumluluğu için aşağıdaki
çıktılar da normalize edilir:

```json
{"action":"BUY","confidence":0.72}
```

`action`, `decision` ve `label` alanları normalize edilir. Yalnızca `BUY`,
`SELL` ve `HOLD` kabul edilir. Geçersiz çıktı demo işlem oluşturmaz.

- `BUY`: risk motorundan sonra equity'nin varsayılan %10'u kadar demo alım.
- `SELL`: yalnızca mevcut long demo pozisyonu kapatır; short açmaz.
- `HOLD`: karar olayını kaydeder, trade oluşturmaz.

## Sürekli Jev Demo Döngüsü

Terminalde `Jev'i Çalıştır` sekiz paritenin tamamı için ilk batch kararı hemen
çalıştırır ve `Durdur` seçilene veya servis kapanana kadar devam eder. Her turda
sekiz ayrı TypeSafe choice sorusu tek System One isteğinde gönderilir. Varsayılan
karar aralığı 60 saniye, güvenli minimum aralık 10 saniyedir.

```env
CRYPTO_JEV_LOOP_INTERVAL_SECONDS=60
CRYPTO_JEV_LOOP_MIN_INTERVAL_SECONDS=10
```

API uçları:

- `GET /api/crypto/jev/loop`
- `POST /api/crypto/jev/loop/start`
- `POST /api/crypto/jev/loop/stop`

Her tur Binance public ticker verisini ortak çağrıyla, karar mumlarını kompakt
şekilde alır; Jev kararlarını risk guard üzerinden yalnızca demo ledger'a
uygular. HOLD yalnızca karar kaydı oluşturur. Döngü durumu geçen süreyi, batch ve
tur gecikmesini, sekiz son kararı, execution sonucunu ve hatayı raporlar.

## Başlatma ve Test

```powershell
npm run crypto:observer
npm run dev
npm run test:edith-crypto
npm run test:edith-crypto-ui
npm run lint
npm run build
```

- EDITH UI: `http://localhost:3000`
- Crypto servis: `http://localhost:5000`
- Sağlık: `http://localhost:5000/api/health`

Gerçek Binance order, withdrawal, deposit veya transfer endpointi yoktur.
