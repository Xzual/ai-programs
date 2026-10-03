# E.D.I.T.H. Chat 4 Phase 6 P1 Producer Token Fix

Tarih: 2026-09-28

## Sonuc

Independent QA tarafindan bulunan WebView producer-token acigi backend tarafinda kapatildi. Producer session bootstrap artik asagidaki dort siniri birlikte zorunlu tutar:

1. Gecerli HttpOnly owner session cookie.
2. Same-origin ve gecerli `X-EDITH-CSRF-Token`.
3. Gercek socket adresinden loopback cagri.
4. `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>` ile timing-safe native bridge dogrulamasi.

Owner+CSRF sahibi normal same-origin WebView istegi bridge bearer olmadan HTTP 403 alir ve `producerSessionToken` goremez. Yanlis bearer, `Device` mobile credential ve non-loopback istek de ayni sekilde fail-closed reddedilir.

## HTTP Sozlesmesi

```http
POST /api/edith/mobile/desktop-producer/session/:deviceId
Origin: http://127.0.0.1:<port>
Cookie: edith_owner_session=<HttpOnly owner cookie>
X-EDITH-CSRF-Token: <owner csrf>
Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>
Content-Type: application/json

{}
```

Basarili native-shaped cagri HTTP 201 ile mevcut `data.producerSessionToken` ve safe public session lineage dondurur. Bu response yalniz native Rust istemci tarafindan okunmalidir.

Tum bootstrap cevaplari, hata cevaplari dahil:

- `Cache-Control: no-store, private`
- `Pragma: no-cache`
- `Expires: 0`

Bridge secret, producer token, cookie veya CSRF hata/audit/log mesajlarina eklenmez.

## Replay Davranisi

- Ayni owner binding ve target device icin yeni basarili bootstrap onceki producer session'i rotate eder.
- Onceki token yeni bootstrap sonrasinda ingest yapamaz ve HTTP 401 alir.
- Aktif token icin exact-next sequence korunur; ayni sequence replay HTTP 409 alir.
- Session map bounded ve RAM-only kalir.

## Phase 6G Koordinasyonu

Canonical native header `Authorization: Bearer <EDITH_DESKTOP_BRIDGE_TOKEN>` olarak dogrulandi. Phase 6G ingest zaten bu header'i kullaniyor.

Audit aninda `src-tauri/src/cross_device.rs` icindeki bootstrap POST bu bearer'i gondermiyordu. Scope geregi Chat 4 `src-tauri/**` degistirmedi. Koordineli Chat 6 duzeltmesi bootstrap request zincirine `.bearer_auth(&bridge.token)` ekledi ve Phase 6G testi exact native bearer ile secret-free command result'i dogruladi. Frontend bootstrap request sekli degismedi ve bridge secret JavaScript'e gecmiyor.

## Degisen Dosyalar

- `server/routes/desktopProducer.ts`
- `server/mobile/desktopProducerService.ts`
- `scripts/test-edith-phase6e-backend-integration.ts`
- `docs/EDITH_CHAT4_PHASE6_P1_TOKEN_FIX_2026-09-28.md`
- `docs/EDITH_CHAT4_PHASE6E_BACKEND_INTEGRATION_HANDOFF_2026-09-28.md`
- `docs/EDITH_CHAT8_PHASE6_INDEPENDENT_ACCEPTANCE_2026-09-28.md`

## Test Kaniti

Phase 6E HTTP integration testi sunlari dogrular:

- owner+CSRF without bridge secret -> 403;
- wrong bridge secret -> 403;
- mobile `Device` credential -> 403;
- non-loopback -> 403;
- valid native-shaped bootstrap -> 201 ve no-store;
- eski bootstrap token'i rotation sonrasi -> 401;
- valid producer ingest -> 202;
- exact sequence replay -> 409;
- denied response body'lerinde bridge/mobile secret yok;
- logout producer authority'yi revoke ediyor.

## Sinirlar

- Producer authority ve token hashleri RAM-only'dir; restart sonrasi yeniden bootstrap gerekir.
- Chat 4 Tauri, mobile, UI veya canonical contract dosyalarina dokunmadi.
- Backend/native header entegrasyonu contract ve local HTTP harness seviyesinde dogrulandi. Gercek paired-device bootstrap smoke'u yine release-runtime kaniti olarak ayrica gereklidir.
