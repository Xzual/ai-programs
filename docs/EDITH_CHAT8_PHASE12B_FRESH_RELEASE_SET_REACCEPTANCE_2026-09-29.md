# E.D.I.T.H. Phase 12B Fresh Release Set Independent Re-Acceptance

**Tarih:** 2026-09-29  
**Sorumlu:** Chat 8 - Independent Integration QA  
**Kapsam:** Phase 12A ile uretilen Windows release setinin salt-okunur bagimsiz yeniden kabulu.  
**Release-set freshness karari:** **ACCEPTED**  
**Master release karari:** **NOT_READY**

## 1. Yonetici Ozeti

Phase 12A'nin EXE, sidecar, MSI, NSIS ve portable ZIP'ten olusan besli release seti mevcut 236 paket girdisine karsi bagimsiz olarak dogrulandi. Girdi manifesti ile calisma agaci arasinda hash veya boyut farki yoktur; yalnizca Windows/JSON zaman damgasi yuvarlamasindan kaynaklanan en fazla 0.498 ms fark vardir. Bes artefaktin boyut, SHA-256 ve zaman damgasi provenance kaydiyla birebir uyumludur ve tumu en yeni paket girdisinden sonradir.

Portable paket 11,437 payload dosyasi ile manifest, SHA256SUMS ve ZIP acma kontrollerini gecti. Portable EXE ve sidecar current release ciktilariyla byte-level aynidir; `dist`, `crypto` ve bundled Python agaclari digest seviyesinde esittir. Portable uygulama bagimsiz bir gecici kokte baslatildi; sidecar goruldu, kontrollu crash sonrasi yeniden basladi, ikinci instance reddedildi ve normal kapanis tum alt surecleri temizledi.

MSI bagimsiz olarak WiX `dark.exe` ile acildi. Ic sidecar current sidecar ile byte-level aynidir. MSI ic EXE'si final release EXE ile byte-level ayni degildir, ancak ayni current source/package-input revision'indan uretilmistir ve Phase 11 junction/reparse guvenlik markerlari binary icinde bulunmustur. NSIS icin mevcut ortamda desteklenen bagimsiz extractor yoktur; generated NSIS scripti current EXE ve sidecar yollarini gostermekte, setup provenance/hash/freshness ve ayni build kosusu bunu desteklemektedir. Bu sinir raporda acik tutulmustur.

Tek acik release-set engeli kod imzasidir: release EXE, sidecar, MSI, NSIS ve portable icindeki iki PE `NotSigned` durumundadir. Bu nedenle freshness kabul edilse de production/master kabul verilemez.

## 2. Kapsam ve Koruma Sinirlari

- Urun kaynagi, Crypto kaynagi, task queue ve Git state degistirilmedi.
- Dirty working tree temizlenmedi, resetlenmedi, stage edilmedi veya overwrite edilmedi.
- `npm run build` bilerek yeniden kosulmadi; yeniden build mevcut kabul adayinin zaman damgasi/freshness zincirini degistirirdi.
- Paketli runtime yalniz marker-gated gecici dizinlerde calistirildi.
- Gercek proje `.edith` verisi ve Crypto live-trading davranisi degistirilmedi.
- Bu turun kasitli dosya degisiklikleri yalniz bu rapor ile Phase 9/master belge guncellemeleridir.

## 3. Komutlar ve Sonuclar

| Komut / inceleme | Sonuc | Ozet |
|---|---:|---|
| Phase 12A handoff ve `artifacts/phase12a-fresh-release-set/*` incelemesi | PASS | Provenance, input manifest, parity, runtime, junction, guard ve inventory kanitlari okundu. |
| 236 paket girdisinin mevcut boyut/hash/mtime karsilastirmasi | PASS | 0 icerik farki; en yuksek mtime yuvarlama farki 0.498 ms. |
| Bes artefaktin boyut/hash/mtime karsilastirmasi | PASS | Provenance ile birebir; tumu en yeni girdiden fresh. |
| `npm run lint` | PASS | `tsc --noEmit`, hata yok. |
| `npm run desktop:portable:verify` | PASS | ZIP hash dogru; 11,437 dosya; manifest ve extracted tree dogru. |
| `npm run test:edith-portable-security` | PASS | Traversal, absolute path, drive path, ADS ve case collision reddedildi; eksik Python fail-closed. |
| `npm run test:edith-desktop-python-lock` | PASS | Broad requirement reddedildi; exact lock kabul; mismatch reddedildi. |
| `node scripts/test-edith-crypto-runtime-lock.mjs` | PASS | 16 exact pin ve import closure dogru. |
| `node scripts/test-edith-crypto-packaged-runtime.mjs` | PASS | Resource discovery, cwd independence, state separation ve managed status gecti; real order false. |
| `node scripts/test-edith-crypto-staged-runtime.mjs` | PASS | Health/status 200; `realOrderEndpointsAvailable:false`, `liveExecutionEnabled:false`. |
| `npm run smoke:edith-desktop-release` | EXTERNAL_BLOCKER | 25 PASS, 0 FAIL, 4 EXTERNAL_BLOCKER; dort blocker yalniz Authenticode. |
| Portable EXE custom lifecycle smoke | PASS | Launch, sidecar, bounded restart, single-instance ve normal close gecti. |
| Current EXE junction probe | PASS | Exit 101; symbolic-link kok reddedildi; target altina app/webview verisi yazilmadi. |
| WiX `dark.exe` MSI extraction | PASS/PARTIAL | 11,445 stream; sidecar exact current hash; ic EXE current revision/fix markerlari mevcut fakat final EXE ile byte-identical degil. |
| Generated WiX/NSIS source pointer incelemesi | PASS | Her iki installer current release EXE/sidecar kaynak yollarini kullaniyor. |
| `Get-AuthenticodeSignature` (6 PE/MSI hedefi) | BLOCKED | Tum hedefler `NotSigned`. |
| `npx vite preview --host 127.0.0.1 --port 4173` + @Tarayici | PASS | Backend kapaliyken UI `Arka ucu OFFLINE`, provider/security `PENDING`, Tauri `DEGRADED`, computer use `SADECE OKUMA` gosterdi; sahte online yok. |
| `.edith` ve owned-process son kontrolu | PASS | 39 dosya, 69,887,062 byte; DB boyut/mtime/hash baseline ile ayni; kalan `edith.exe`/sidecar sureci yok. |
| `git status --short` ve `git diff --check` | PASS | Mevcut dirty tree korundu; whitespace error yok, yalniz CRLF uyarlari. |

## 4. Release Artefakt Matrisi

| Artefakt | Boyut | SHA-256 | Fresh | Imza |
|---|---:|---|---:|---|
| `src-tauri/target/release/edith.exe` | 17,176,064 | `19ed5bcce966a22e39b6f571c459cd59bfbb113c95f6df3cfe698b96538a775e` | PASS | NotSigned |
| `src-tauri/target/release/edith-backend.exe` | 50,687,222 | `08634974dc74126b86a35aea0a49e2242b6ddab1c4f026fc5a7a7b53eaf01d1c` | PASS | NotSigned |
| `E.D.I.T.H._1.0.0_x64_en-US.msi` | 149,656,412 | `73caa534507cdeb519f71be7ed6662bdacf66915706e18a688b118e91168fb4e` | PASS | NotSigned |
| `E.D.I.T.H._1.0.0_x64-setup.exe` | 99,994,001 | `a5e3b720c3246a3b7df98746ab1705185a874e97dcfbba2cd1ecbd2b9bda15c9` | PASS | NotSigned |
| Portable ZIP | 151,781,989 | `6ad8cc04e99984a65df53c52a7bcdfdfc6f475192b93f5e40b3d1f81b282e14e` | PASS | ZIP icin N/A; ic PE'ler NotSigned |

En yeni scoped paket girdisi `src-tauri/src/lib.rs` (`d4ecbf...`, artifact kaydinda `2026-09-29T01:24:18.525Z`). Bes cikti da bu girdiden sonradir. Packaging input count 236, input difference 0'dur.

## 5. Portable Dogrulamasi

- Manifest payload sayisi: **11,437**.
- EXE: current release hash ile exact match.
- Sidecar: current release hash ile exact match.
- Frontend `dist`: 4/4 dosya, tree digest match.
- Crypto resources: 33/33 dosya, tree digest match.
- Bundled Python: 11,398/11,398 dosya, tree digest match.
- Crypto payload'inda `.env`, `.venv`, `.git`, `__pycache__`, pytest cache, DB, log veya pyc bulunmadi.
- Bundled Python agacinda `__pycache__`, pyc veya pyo bulunmadi.
- ZIP guvenli extraction ve tum path/hash kontrolleri gecti.
- Lifecycle: launch PASS; sidecar child PASS; kontrollu restart PASS; single-instance PASS; normal close/cleanup PASS.

## 6. MSI ve NSIS Dogrulamasi

MSI `dark.exe` ile gecici dizine acildi. Extract edilen `edith-backend.exe` SHA-256 degeri current sidecar ile aynidir. Extract edilen ana EXE'nin SHA-256 degeri `f138b430178dd28b3425b9670d7cbf11324b6c347a2197f7ef82404915b1a6e1` olup final release EXE hashinden farklidir. Bununla birlikte EXE boyutu current ciktiyla aynidir; Phase 11 fix markerlari, symbolic-link ve junction/reparse red metinleri binary icinde bulunur. Generated WiX kaynagi current `src-tauri/target/release/edith.exe` ve Tauri sidecar kopyasini gostermektedir.

NSIS setup icin bagimsiz byte-level extraction bu makinedeki araclarla yapilamadi. Generated `installer.nsi` current release EXE'yi ve current Tauri sidecar kopyasini kaynak gosterir. Setup zamani en yeni girdiden sonradir; provenance ve smoke hashleri mevcut dosyayla aynidir. Bu, current revision paketlemesini destekler ancak Authenticode engelini kapatmaz.

## 7. Guvenlik ve Crypto

- Junction/reparse root guvenlik duzeltmesi current EXE hashinde bagimsiz yeniden oynandi ve fail-closed gecti.
- Python lock 16 exact pine sahip; import closure gecti.
- Packaged/staged Crypto `realOrderEndpointsAvailable:false` ve `liveExecutionEnabled:false` dondurdu.
- Live/private trading veya gercek para davranisi acilmadi.
- Portable Crypto payload'inda runtime veri/secrets bulunmadi.
- Preview backend olmadan gercek olmayan `online`, provider veya native capability iddiasi gostermedi.
- Release smoke'taki tek blocker sinifi imzadir; functional failure yoktur.

## 8. Veri Butunlugu ve Cleanup

Baslangic ve bitis kontrollerinde `.edith` 39 dosya ve 69,887,062 byte olarak kaldi. `edith.db` 53,260,288 byte, mtime tick `639262252175863204`, SHA-256 `3ee2e2dcf762a4ddb91b48891af4b690acf94c59e69d15c13e3396e7d368dcff` ile aynidir. Test sonunda exact EDITH EXE/sidecar process kalmadi. Marker-gated runtime gecici kokleri cleanup edildi.

## 9. Acik Riskler ve Sinirlar

1. **P1 / External:** EXE, sidecar, MSI ve NSIS imzasizdir; portable icindeki PE'ler de imzasizdir.
2. **P1 / Master:** Phase 9 A-S matrisindeki native/device/provider E2E eksikleri devam eder.
3. **P2 / Evidence limit:** NSIS payload'i bagimsiz extractor ile acilmadi; source pointer, provenance ve smoke ile dogrulandi.
4. **P2 / Binary identity:** MSI ic ana EXE final release EXE ile byte-level ayni degildir; ayni current source revision/fix markerlari kabul edildi. Reproducible/byte-identical packaging iddiasi yapilmamistir.
5. `npm run build` bu turda yeniden kosulmadi; kabul edilen seti stale hale getirmemek icin mevcut Phase 12A build kaniti ve input manifesti kullanildi.

## 10. Onerilen Son Duzeltmeler

1. Ayni kabul edilen hashleri koruyarak guvenilir Windows sertifikasi ile EXE, sidecar, MSI ve NSIS'i imzala; imza sonrasi hash/provenance ve smoke matrisini yeniden olustur.
2. Imzalama paketleri degistirecegi icin signed release set uzerinde portable verify, MSI/NSIS smoke ve Authenticode zincirini yeniden kos.
3. Mumkunse CI'ya MSI/NSIS payload BOM ve current EXE/sidecar identity kontrolu ekle; MSI ana EXE nonidentity'sini acik ve otomatik olarak siniflandir.
4. Master kabul icin kalan fiziksel mobile, native Computer Use/Browser, API33/35 ve A-S E2E blockerlarini ayri fazlarda kapat.

## 11. Nihai Karar

**Release-set freshness: ACCEPTED**

MSI ve portable icin onceki `stale` blocker kapanmistir. Besli Windows release seti current package-input revision'a aittir; portable butunlugu ve runtime lifecycle bagimsiz gecti; junction guvenlik duzeltmesi ve Crypto live lock korunmustur.

**Master release: NOT_READY**

Kod imzasi ve daha once kayitli master native/device/E2E blockerlar aciktir. Proje bu branch'ten gelistirmeye devam etmek icin uygundur, ancak production-ready veya master-accepted olarak ilan edilmemelidir.
