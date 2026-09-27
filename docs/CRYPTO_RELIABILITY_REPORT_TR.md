# E.D.I.T.H. Crypto Guvenilirlik Raporu

Tarih: 23 Eylul 2026. Kapsam yalnizca Crypto demo islem guvenilirligidir.

## A. Audit Sonucu

Onceki surum gercek Binance public verisi ve gercek Jev baglantisi kullaniyordu.
Ancak bakiye, pozisyon, karar ve islem kayitlari ayri commit ediliyordu.
Arayuz tasarimi korunarak backend guvenilirligi tamamlandi.

## B. Kok Riskler

Tekrarlanan kismi satis, zaman asiminda belirsiz sonuc, kaybolan basarisiz Jev
denemesi, tarihsiz fiyatla islem ve gecmisi silen reset davranisi duzeltildi.
Ek kontrolde eski pozisyon alanlari, tutarsiz eszamanli okumalar, rezervasyon
iceriginin degistirilebilmesi ve rollback sonrasinda karar kaybi da duzeltildi.

## C. Degisen Dosyalar

- `crypto/src/demo_portfolio.py`, `demo_migration.py`, `price_freshness.py`
- `crypto/src/demo_execution.py`, `dashboard.py`, `config.py`
- `crypto/src/market_service.py`, `jev_adapter.py`, `jev_loop.py`
- `crypto/run_agent.py`, `.env.example`, `package.json`
- `crypto/test_jev_demo.py`, `test_demo_hardening.py`, `test_api_reliability.py`
- `crypto/test_market_reliability.py`, `test_runtime_reliability.py`
- `server/routes/crypto.ts`
- `src/components/crypto/CryptoExchangeTerminal.tsx`, `cryptoApi.ts`, `useCryptoOperation.ts`
- `scripts/test-edith-crypto-recovery.mjs`, `test-edith-crypto-real-recovery.mjs`
- `.cursor/agents/edith-crypto-jev-auditor.md`
- `docs/CRYPTO_BACKEND_RELIABILITY.md`, bu rapor

Depodaki diger mevcut degisiklikler geri alinmadi. Gemini, ses, Supabase, Tauri,
Computer Use ve genel Obsidian sistemine bu is kapsaminda kod degisikligi yapilmadi.

## D. Idempotency

Bes mutasyon `clientRequestId` veya `idempotencyKey` ister. Ayni kimlik ve ayni
normalize icerik ilk kalici sonucu aynen dondurur. Farkli icerik reddedilir.
Eszamanli devam eden ayni istek 409 `operation_in_progress` dondurur.

## E. Transaction ID Sistemi

`crypto_op_*`, `demo_trade_*`, `jev_decision_*`, `demo_decision_*` ve
`demo_session_*` kimlikleri sunucuda uretilir. API ve ekranda gorunurler.

## F. Timeout Recovery

Arayuz bekleyen kimligi ve guvenli istek icerigini oturumda saklar. Kaybolan
yanittan sonra sadece ayni islemi sorgular. Kayit yoklugu dogrulanirsa kullanici
ayni kimlik/icerikle acikca yeniden gonderebilir. Yeni kimlikle kor tekrar yoktur.
Sayfa yenileme, gec gelen yanit ve bozuk lookup cevaplari test edildi.

## G. Jev Decision History

Gecerli kararlar, HOLD, risk vetolari, gecersiz cikti, ulasilamama ve zaman asimi
kalici kaydedilir. Veritabani yazmasi geri alinsa bile gercek gelen Jev karari
korunur; sadece uygulama basarisiz isaretlenir. Gizli dusunce veya ham cevap yoktur.

## H. Karar ve Islem Baglantisi

Jev kararindan uretilen demo islem dogru `decisionId` ile baglanir; karar da
`tradeId` tasir. Manuel AL/SAT kayitlarinda `source=manual`, `decisionId=null` olur.
HOLD islem veya ucret olusturmaz.

## I. Fiyat Guncelligi

15 saniyelik yapilandirilabilir fiyat yasi siniri, Jev yanitindan sonra tekrar
kontrol edilir. Pozisyonlar fiyat zamani/yasi/durumu; portfoy degerleme zamani ve
en eski fiyat yasini gosterir. Eski veya eksik fiyat yeni pozisyon acamaz.

## J. Atomiklik

Bakiye, pozisyon, ucret, islem, karar baglantisi ve sonuc tek SQLite yazma
transaction'inda saklanir. Okumalar da tek tutarli snapshot kullanir. Hata enjekte
edilerek yarim guncellemenin geri alindigi dogrulandi. Negatif nakit, kisa pozisyon,
kaldirac, buyuk pozisyon, asiri exposure ve pozisyon sayisi engelleri test edildi.

## K. Reset ve Session

Reset acik onay, STOPPED dongu ve bekleyen islem olmamasi kosullarini ister.
Eski oturum/kararlar/islemler arsivde kalir; yeni oturum 10.000 krediyle acilir.
Mevcut hesap baslangic bakiyesi farkli olsa bile migration otomatik reset yapmaz.

## L. API Degisiklikleri

Operation lookup, trade lookup, filtrelenebilir karar gecmisi/latest/lookup ve
session/session history eklendi. Yanitta `ok/data/meta`, hatada guvenli kod/mesaj
vardir. Mevcut kok alanlar ve tekil `decision/latest` uyumlulugu korundu.

## M. Frontend Sozlesmesi

Tasarim degistirilmedi. Islem/karar/oturum kimlikleri, fiyat guncelligi,
bekleyen/dogrulanan/reddedilen islem durumu ve guvenli tekrar kontrolu eklendi.
Gecerli Jev kararinin risk vetosu da terminal sonuc olarak dogru ele alinir.

## N. Test Sonuclari

- `npm run test:edith-crypto`: gecti.
- `npm run test:edith-crypto-hardening`: 55 test gecti (16 ledger, 3 API, 36 market/Jev).
- `npm run test:edith-crypto-ui`: alti viewport gecti, tasma/bozuk grafik yok.
- `node scripts/test-edith-crypto-ui-states.mjs`: 12/12 gecti.
- `node scripts/test-edith-crypto-recovery.mjs`: proxy ve iki yanit biciminde recovery senaryolari gecti.
- `node scripts/test-edith-crypto-real-recovery.mjs`: gercek veriyle izole arayuz testi gecti.
- `crypto\\.venv\\Scripts\\python.exe crypto\\test_runtime_reliability.py`: gercek veri, Jev ve proses restart/replay testi gecti.
- `npm run lint`, `npm run build`, ilgili `git diff --check`: gecti.

Ilk denemelerde servis hazir olmadan baslatilan UI testleri ve test kapanisindaki
Windows/route temizligi hatalari oldu. Test duzenegi duzeltildi; son kosular
basarili cikis koduyla tamamlandi. Build'de buyuk bundle uyarisi kaldi, hata degil.

## O. Gercek Veriyle Demo Testi

Kullanicinin hesabindan ayri, gecici 10.000 kredilik hesap kullanildi. Gercek
Binance fiyatinda 100 kredi AL, HOLD ve SAT dogrulandi. AL yaniti tarayicida
bilerek kesildi; ekran kalici kayittan sonucu buldu ve ikinci AL gondermedi.
Ayni kimlikle tekrar da ayni tradeId dondurdu. Gercek Jev `jev-1.13.0` HOLD
dondurdu: son UI testinde 852 ms, proses restart testinde 876 ms. Bunlar olculen
tekil surelerdir, gecikme garantisi degildir. Proses tamamen yeniden baslatildiktan
sonra hem AL hem Jev istegi eski sonuclarini yeni islem/model cagrisi olmadan dondurdu.

## P. Gercek Islem Guvenligi

Gercek emir yolu yok. Binance public veri istemcisi kullaniliyor. Ozel emir,
withdrawal, transfer, kaldirac veya futures cagrisi bulunmadi. Live flag acilsa
bile demo execution engellenir. Obsidian, haber, ogrenme ve Ollama kapali kaldi.

## Q. Migration Sonucu

Mevcut veritabani SQLite backup ile yedeklendi:
`crypto/data/agent_memory.db.pre-reliability-v2.bak`.
7 islem ve 68 karar yeni tablolara korundu; eski tablolar da yerinde duruyor.
Nakit 9996.103159568042 olarak korundu (API yuvarlatmasi 9996.10315957).
Kullanicinin hesabi sifirlanmadi. Eski kayitlarin fiyat zamanlari uydurulmadi;
`legacy_unverified` olarak isaretlendi.

## R. Kalan Riskler

Binance/Jev baglantisi kesilebilir veya limit koyabilir. Arayuz bunu gizlemez.
Ani proses sonlandirmada bekleyen rezervasyon en gec 120 saniyelik lease sonrasi
sorguda failed olur; otomatik yeniden islem yapmaz. Yerel disk dolulugu/arizasi
kayit yazimini engelleyebilir. Kalici gecmis buyuyecegi icin yedekleme ve ileride
acik onayli arsiv politikasi gerekir. `.venv`, data, log, backup ve QA gorselleri
repo icerigi degildir; kullanici verisi temizlenmedi. Demo simulasyonu gercek
borsa dolumunu, kaymayi ve piyasa riskini tam temsil etmez; kar garantisi yoktur.

## S. Sonraki Adim

Uygulama `http://localhost:3000/`, Crypto API `http://localhost:5000/api/health`
adresinde acik. Mode OBSERVER_ONLY; eski trading/paper/live false, demo true.
Jev dongusu STOPPED birakildi; baslatilinca sekiz pariteyi kapsar. Ana proses
yeniden acildigi icin Jev durumu ilk yeni cagridan once durustce unverified'dir.
Sonraki mantikli adim, kullanicinin secili aralikla demo dongusunu baslatip yeni
kimlikli karar/islem gecmisini izlemesidir.

Kanitlar: `artifacts/crypto-terminal/reliability-runtime.json`,
`real-recovery-ui.json`, `real-recovery-desktop.png` ve mevcut viewport/state QA ciktisi.
