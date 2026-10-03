# E.D.I.T.H. Phase 11D - Obsidian First-Run Desktop UI Handoff

Tarih: 2026-09-29  
Sahip: Chat 2 - Frontend / Desktop UI  
Durum: IMPLEMENTED / MOCKED DESKTOP SMOKE PASS / REAL PICKER E2E NOT_RUN

## Uygulanan kapsam

- Aktif `FocusedSettingsScreen` içindeki Workspace bölümüne Obsidian knowledge provider paneli eklendi.
- Provider durumu yalnızca `GET /api/edith/obsidian/provider/status` ile okunuyor ve strict `ObsidianProviderPublicStatusV1` parser'ından geçiriliyor.
- Taze kurulum `FIRST_RUN_REQUIRED` ve `VAULT_SELECTION_REQUIRED` literal değerleriyle gösteriliyor.
- Native picker yalnızca kullanıcının `Obsidian klasörü seç` veya `Obsidian klasörünü değiştir` eylemiyle başlatılıyor.
- Activate/change mutation'ları empty JSON `{}`, benzersiz idempotency key ve mevcut owner-session/CSRF altyapısını kullanıyor.
- Yalnızca kesin `HTTP 428 + NATIVE_SELECTION_REQUIRED` yanıtı native `obsidian_request_vault_folder` komutunu argümansız çağırabiliyor.
- Cancel, submitted ve configuration-required native sonuçlarından sonra provider durumu yeniden okunuyor. Cancel başarı gibi gösterilmiyor.
- `READY` yalnızca public status `READY` ve `writable: true` olduğunda gösteriliyor.
- `DEGRADED` ve writable olmayan tutarsız READY durumları pasif kalıyor; otomatik popup veya retry loop yok.
- Revoke iki adımlı explicit onay kullanıyor, protected empty mutation gönderiyor ve status refetch sonrası `VAULT_SELECTION_REVOKED` gösteriyor.
- Browser/dev ortamı raw path input fallback'i sunmuyor; `Desktop native picker required` güvenli mesajıyla fail closed kalıyor.
- Workspace özetinden absolute workspace/Obsidian path render alanları kaldırıldı. Serbest backend hata/safeMessage metinleri allowlisted statik UI metnine dönüştürüldü.

## Güvenlik ve veri sınırı

- UI absolute vault path, native handle, selection ID, token veya device ID okumuyor, saklamıyor, loglamıyor ve render etmiyor.
- `localStorage`, `sessionStorage` ve `<input type="file">` kullanılmıyor.
- Native yanıt parser'ı yalnızca `status` ve `publication` alanlarını okuyor.
- Public status unknown/sensitive field içerirse strict parser durumu reddediyor; UI hazır bağlantı varsaymıyor.
- Bu entegrasyon knowledge-only'dir: `executionAuthority: false`, autonomous sync yok, background picker yok.

## Değişen dosyalar

- `src/components/settings/FocusedSettingsScreen.tsx`
- `src/components/settings/ObsidianProviderPanel.tsx` (yeni)
- `src/edith/obsidianProviderClient.ts` (yeni)
- `src/edith/settingsRuntimeService.ts`
- `scripts/test-edith-phase11d-obsidian-ui.ts` (yeni)
- `scripts/test-edith-phase11d-obsidian-ui.mjs` (yeni)
- `package.json`
- `artifacts/phase11d-obsidian-ui/*` (mock smoke çıktıları)
- `docs/EDITH_CHAT2_PHASE11D_OBSIDIAN_FIRST_RUN_UI_HANDOFF_2026-09-29.md` (bu rapor)

Backend, Rust native picker, crypto ve Mark-L uygulama dosyaları değiştirilmedi.

## Test sonuçları

- `npm run lint` - PASS
- `npm run build` - PASS; yalnız mevcut Vite 500 kB chunk warning'i sürüyor.
- `npm run test:edith-phase11d-obsidian-ui` - PASS
- `npm run test:edith-phase11d-obsidian-browser` - PASS
- `npm run test:edith-phase11c-obsidian-backend` - PASS, isolated runtime DB unchanged
- `npm run test:edith-obsidian-provider` - PASS
- `npx tsx scripts/test-edith-phase11b-native-vault-picker.ts` - PASS
- `npm run test:edith-backend-security` - PASS, isolated runtime DB unchanged
- `npm run test:edith-interaction-safety` - PASS
- `npm run test:edith-phase7f-ui` - PASS

Playwright mock smoke viewports:

- 390x844 - PASS
- 768x1024 - PASS
- 1366x768 - PASS
- 1920x1080 - PASS

Doğrulanan browser davranışları: explicit picker only, no-arg invoke, cancel harmless, revoke/refetch, non-Tauri fail closed, focus transfer to revoke confirmation, no horizontal overflow, no major console/page error ve sensitive canary değerlerinin DOM'da bulunmaması.

Gerçek Tauri picker/vault/DB testi: **NOT_RUN**. Bu faz gerçek kullanıcı klasörü seçmedi ve gerçek vault'a yazmadı.

## Runtime bütünlük guard'ı

Phase başlangıcındaki tam `.edith` envanteriyle bitiş envanteri karşılaştırıldı:

- File count: 39 -> 39
- SHA-256: tüm dosyalar aynı
- Size: tüm dosyalar aynı
- Last-write time: tüm dosyalar aynı
- `.edith/edith.db`: SHA-256 `3EE2E2DCF762A4DDB91B48891AF4B690ACF94C59E69D15C13E3396E7D368DCFF`, 53,260,288 byte, unchanged

## Runtime durumu ve riskler

- Fresh/revoked, ready, degraded, cancel ve browser fail-closed dalları contract/mock katmanında doğrulandı.
- Gerçek Windows native dialog UX'i ve gerçek verifier publication zinciri bu frontend fazında çalıştırılmadı.
- Mobil 390px ekranında içerik tek kolonda ve yatay taşmasız; uzun Settings ekranı doğal dikey scroll kullanıyor.
- Production bundle büyük chunk warning'i bu fazdan önce var olan genel uygulama riskidir; Obsidian akışını engellemiyor.

## Chat 6 için sonraki kesin sözleşme

1. Disposable bir test vault ile paketlenmiş Tauri uygulamasında yalnız explicit UI click sonrasında `obsidian_request_vault_folder` açıldığını E2E doğrula.
2. WebView'dan komuta hiçbir argüman gitmediğini ve native response içindeki handle/path/selection/device verilerinin WebView log/DOM/state'e taşınmadığını denetle.
3. Gerçek dialog cancel, submitted ve verifier-unavailable sonuçlarını ayrı ayrı doğrula; cancel hiçbir config değişikliği veya READY üretmemeli.
4. Test sonunda disposable vault ve test config dışında gerçek vault/`.edith` runtime'ına dokunulmadığını hash/size/mtime guard ile kanıtla.

## Chat 8 için sonraki kesin sözleşme

1. Bu handoff ile Phase 11A/11B/11C kontratlarını bağımsız karşılaştır; özellikle exact 428 gate, empty mutation body, owner origin/CSRF/idempotency ve no-arg invoke şartlarını doğrula.
2. Paketlenmiş desktop build üzerinde fresh install, restart READY/no-popup, DEGRADED/no-popup, explicit change, cancel ve revoke senaryolarını kabul testine al.
3. DOM, console, network response tüketimi ve client state için path/handle/selection ID/token/device ID leak audit yap.
4. 390/768/1366/1920 viewport, keyboard focus, screen-reader labels ve horizontal overflow sonuçlarını bağımsız kaydet.
5. Gerçek picker E2E tamamlanmadan Phase 11'i native end-to-end accepted olarak işaretleme.
