# E.D.I.T.H. Crypto Demo Exchange UI

Tarih: 2026-09-22. Kapsam: frontend, mevcut demo API baglantilari ve UI testleri.

## Alt ajan denetimi ve hedef tasarim

- Tasarim denetimi: mevcut demo kontrol ve guvenlik yapisi korundu. Zayif hiyerarsi, kucuk/dusuk kontrastli etiketler, grafik zoom'unun yenilemede sifirlanmasi, etiketsiz satis yuzdeleri ve mobilde uzun piyasa listesi belirlendi.
- Hedef: kalici guvenlik seridi; solda piyasa listesi, merkezde buyuk mum/hacim grafigi, sagda derinlik ve demo emir paneli; altta portfoy, Jev, pozisyonlar ve islem gecmisi.
- Hareket bilesenleri alt ajani: gercek deger degisimlerine bagli fiyat vurgusu, sayisal gecisler, derinlik satirlari ve BUY/SELL/HOLD rozetleri.
- Veri denetimi alt ajani: eski yanit yarislari, eksik/bozuk veri, belirsiz Jev dongusu ve manuel karar kaynagi ayrimini kontrol etti.
- QA alt ajani: gercek endpointlerle responsive tarama ve agdan izole durum testleri.

## Uygulama

- Assistant tema aksani, notr koyu yuzeyler, tabular sayilar ve semantik piyasa renkleri kullaniliyor.
- Sekiz paritenin fiyatlari mevcut public market endpointlerinden sinirli eszamanlilikla okunuyor. Alinamayan/eski degerler canli gibi gosterilmiyor.
- Mumlar, hacim ve derinlik backend verisinden geliyor. Grafik yenilemesi kullanicinin zoom/pan secimini koruyor.
- Run Jev Decision, mevcut tekil karar endpointine baglandi. Yapilandirilan model, kaynak, parite, guven, gecikme, zaman ve risk/uygulama sonucu gosteriliyor.
- Manuel kayit Jev ciktisi olarak etiketlenmiyor. Gecikmesi olmayan karara baska istegin gecikmesi atanmiyor.
- Demo AL/SAT/HOLD, satis orani, kullanilabilir bakiye, tahmini ucret ve onayli sifirlama korunuyor. Sifirlama icin dongunun STOPPED oldugu dogrulanmali.
- Her veri kaynagi ayri basarisiz olabiliyor; tek endpoint hatasi tum basarili panelleri kaybettirmiyor. Bozuk yanitlar ve gecikmis eski secim yanitlari reddediliyor.
- Belirsiz dongu durumunda tekil karar ve sifirlama kapali; Durdur kurtarma yolu erisilebilir.
- DEMO MODE, 10,000 CR baslangic, NO REAL MONEY, NO REAL ORDERS, SIMULATION ONLY ve LIVE TRADING DISABLED gorunur. Obsidian/news/learning/Ollama bu fazda kapali.

## Dosyalar

- src/components/crypto/CryptoExchangeTerminal.tsx
- src/components/crypto/TerminalPrimitives.tsx
- src/components/crypto/crypto-terminal.css
- scripts/test-edith-crypto-ui.mjs
- scripts/test-edith-crypto-ui-states.mjs
- docs/CRYPTO_TERMINAL_UI_QA.md

Backend, Binance execution, crypto Python ve API key saklama mantigi degistirilmedi. Calisma agacinda daha onceden bulunan diger ekip degisiklikleri korundu.

## Dogrulama

- `npm run lint`: gecti.
- `npm run build`: gecti; Vite 500 kB bundle boyutu uyarisi mevcut.
- `npm run test:edith-crypto`: gecti; gecici DB ve kontrollu provider yanitlariyla backend demo regresyonlari.
- `npm run test:edith-crypto-ui`: 390x844, 768x1024, 1366x768, 1440x900, 1920x1080, 2560x1440. Tasmasiz yerlesim, kirpilmayan kontroller, dolu grafik pikselleri, guvenlik ve gercek endpoint durumlari denetleniyor.
- `node scripts/test-edith-crypto-ui-states.mjs`: 12 izole test. Tam offline, yalniz piyasa hatasi, bozuk dongu, ters sirada piyasa yanitlari, null/eksik/bos sayilar, BUY/SELL/HOLD, gecersiz karar ve karar feed hatasi. Reduced motion altinda aktif animasyon yok. Test verileri uygulamaya eklenmez; yazma istekleri agdan engellenir.
- Tarayicida gercek demo test: 100 CR BUY, HOLD, pozisyonun tamami SELL. Iki FILLED/manual/DEMO kaydi geldi; test pozisyonu kapandi. Mevcut hesap sifirlanmadi.
- Gercek Jev: ilk deneme jev_unavailable, hata durumu gorunur. Ikinci deneme 23:21:49 yerel saatte HOLD, confidence 0.99, latency 891 ms, source jev, risk APPROVED; yeni demo emir yok.
- Ekran goruntuleri ve makine-okunur sonuclar: artifacts/crypto-terminal/. Sentetik test ekranlari fixture-states/ altinda TEST FIXTURES ONLY olarak isaretli.

## Kalan sinirlar

- Jev ve Binance kullanilabilirligi harici servislere bagli; basarili tek istek kesintisiz baglanti garantisi degildir.
- Mevcut proxy timeout'u bir demo mutasyonunun nihai sonucunu belirsiz birakabilir. UI tekrar gondermeden once gecmisi kontrol etmeyi ister. Backend idempotency/islem kimligi gelistirmesi backend ekibine aittir.
- Portfolio endpointi fiyat kaynagi zamanini her pozisyon icin vermiyor; UI son alinmis fiyatla degerleme olabilecegini belirtir.
- latest decision endpointi genel son kaydi verir; kalici Jev-ozel karar gecmisi bu calismaya eklenmedi.
- Yeni backend trading logic, gercek emir yolu, key alani veya canli trading anahtari eklenmedi.
