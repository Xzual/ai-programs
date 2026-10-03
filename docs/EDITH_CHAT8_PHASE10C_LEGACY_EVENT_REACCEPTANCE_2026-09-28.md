# E.D.I.T.H. Phase 10C Legacy Event Re-Acceptance

**Tarih:** 2026-09-28  
**Sorumlu:** Chat 8 - Integration QA  
**Kapsam karari:** **PASS**  
**Genel release karari:** **NOT_READY**  
**Degisiklik siniri:** Urun kaynagi, task queue, Crypto, Git state ve runtime DB degistirilmedi. Yalniz kabul raporlari guncellendi.

## 1. Amac

Phase 10A'da persisted `status`, `plan` ve `audit` timeline satirlarinin strict V2 parser'a verilmesiyle olusan `UNKNOWN_TASK_EVENT_TYPE` hatasinin duzeltmesini bagimsiz olarak yeniden kabul etmek. Duzeltmenin canonical event semantigini gevsetmemesi, legacy kayitlari uydurma canonical olaya cevirmemesi, desktop/mobile consumer parity'sini korumasi ve gercek runtime DB'yi degistirmemesi zorunluydu.

## 2. Sonuc Ozeti

- Strict V2/V2.1 parser degismedi ve bilinmeyen eventleri reddetmeye devam ediyor.
- Persisted legacy `status`, `plan`, `audit` satirlari yalniz projection sinirinda, `LEGACY_TASK_EVENT_UNSUPPORTED` nedeni ile karantinaya aliniyor.
- Ayni task icindeki canonical `task.step_updated` olayi korunuyor.
- Fixture task `RUNNING`, `1/3` adim, `%27`, revision 1 ve terminal false olarak desktop, encrypted mobile ve UI'da tutarli.
- Diagnostics 100 kayitla sinirli; source toplam/truncated bilgisi var. Diagnostics girdilerinde message, payload, actor, path veya secret yok.
- Cross-task, snapshot revision'inin ilerisindeki ve invalid canonical olaylar fail-closed karantinaya aliniyor.
- Test modu explicit guvenli temp data dir olmadan fail-closed.
- Gercek `.edith/edith.db` dosyasi ve mevcut 3096 audit satiri degismedi; daha once sizmis 32 test audit kaydi silinmedi veya yeniden yazilmadi.

## 3. Calistirilan Kontroller

| Komut / kontrol | Sonuc | Kanit |
|---|---:|---|
| `npm run test:edith-phase10a-legacy-task-events` | PASS | Canonical preserve, legacy/invalid/cross-task/ahead quarantine, bounded/payloadless diagnostics, progress truth, restart idempotence, test isolation. |
| `npm run test:edith-backend-security` | PASS | Desktop activity endpoint ve diagnostics guvenlik siniri. |
| `npm run test:edith-mobile-backend` | PASS | Device auth, encrypted envelope, replay/tamper/binding fail-closed. |
| `npm run test:edith-mobile-contract-reconciliation` | PASS | Mobile contract/reducer uyumu. |
| `npm run test:edith-cross-device-phase6` | PASS | Cross-device contract ve guvenlik regresyonu. |
| `npm run test:edith-phase6e-backend-integration` | PASS | Backend integration ve izole runtime. |
| `npm run test:edith-phase7d-native` | PASS | Native/device-scoped publication ve replay sinirlari. |
| `npm run test:edith-contracts` | PASS | Strict parser ve temel contractlar. |
| `npm run test:edith-contracts-v2-1` | PASS | V2.1 task/progress/event tutarliligi. |
| `npm run test:edith-phase7f-ui` | PASS | UI consumer fail-closed ve payload guvenligi. |
| `npx tsx scripts/test-edith-phase3-task-ui.ts` | PASS | Task UI canonical event/progress davranisi. |
| Temp mobile parity harness | PASS | `401` unauthenticated; encrypted response; binding/replay rejected; desktop/mobile events ve diagnostics birebir esit. |
| `npm run lint` | PASS | `tsc --noEmit`, hata yok. |
| `npm run build` | PASS | Vite 1728 modul ve server bundle tamamlandi; 852.64 kB ana JS chunk uyarisi devam ediyor. |

Yedi leak-uretebilen suite paylasilan izole runner ile calisti ve her biri `sourceRuntimeDatabaseUnchanged:true` raporladi.

## 4. Browser Kabulu

OS temp klasorundeki SQLite fixture'a uc legacy satir (`status`, `plan`, `audit`) ve bir canonical `task.step_updated` olayi yerlestirildi. Gercek runtime deposu kullanilmadi.

| Viewport | Tasks surface | Capsule / Command Center | Yatay tasma | `UNKNOWN_TASK_EVENT_TYPE` |
|---:|---|---|---:|---:|
| 390x844 | Baslik, current step, `%27`, canonical event | Compact capsule baslik/current step/%27 | Yok | Yok |
| 768x900 | `RUNNING`, `1/3`, `%27`, canonical event | `RUNNING`, baslik, `%27` | Yok | Yok |
| 1366x768 | `RUNNING`, `1/3`, `%27`, canonical event | `RUNNING`, baslik, `%27` | Yok | Yok |
| 1920x1080 | `RUNNING`, `1/3`, `%27`, canonical event | `RUNNING`, baslik, `%27` | Yok | Yok |

390 px compact capsule explicit `RUNNING` etiketini gizliyor ancak baslik, aktif adim ve `%27` ilerleme gorunur; task state bozulmuyor. Son browser console warning/error listesi bostu.

## 5. Desktop / Mobile Parity

`GET /api/edith/tasks/:id/activity` ile authenticated `GET /api/mobile/tasks/:taskId/activity` ayni projection fonksiyonunu kullaniyor. Bagimsiz temp harness sonucu:

- desktop/mobile event listesi birebir esit: 1 canonical `task.step_updated`
- desktop/mobile diagnostics birebir esit: 3 karantina girdisi
- task status `RUNNING`, progress `%27`, completed 1/3, terminal false
- mobile response encrypted envelope icinde
- credentialsiz istek `401`
- yanlis workspace binding `ENVELOPE_BINDING_INVALID`
- ayni envelope ikinci kez acilinca `ENVELOPE_SEQUENCE_REPLAYED`
- diagnostics payloadless; message/payload/actor/path/secret alani yok

Compatibility amacli legacy `timeline` response'ta tutuluyor ve mobile tarafta safe-text ile redakte ediliyor. UI canonical `events` listesini tuketiyor; legacy satirlari canonical olay gibi render etmiyor.

## 6. Runtime DB Izolasyonu

Baslangic ve bitis snapshot'i birebir ayni:

| Alan | Deger |
|---|---|
| Dosya | `.edith/edith.db` |
| Boyut | `53,260,288` bayt |
| Last write UTC | `2026-09-28T20:46:57.5863204Z` |
| SHA-256 | `3ee2e2dcf762a4ddb91b48891af4b690acf94c59e69d15c13e3396e7d368dcff` |
| `audit_events` satiri | `3096` |

Test backend ve Vite kapatildi; port 3000 ve 5173 dinlemiyor. Temp browser fixture ve temp parity harness temizlendi.

## 7. Kalan Riskler

- Bu PASS yalniz legacy task-event runtime blocker'ini kapatir; Phase 9'daki signed Windows artifact, connected Android, fiziksel mobile, gercek Computer/Browser, Obsidian first-run ve A-S E2E engellerini kapatmaz.
- Build basarili ancak 852.64 kB ana frontend chunk performans uyarisi suruyor.
- Compatibility `timeline` alani halen response'ta bulunuyor. Yeni consumerlar yalniz canonical `events` ve payloadless `eventDiagnostics` kullanmali.
- Daha once istemeden eklenen 32 audit satiri veri koruma ilkesi nedeniyle yerinde birakildi; bu tur yeni satir eklemedi.

## 8. Karar

**Phase 10C scoped re-acceptance: PASS.**

`UNKNOWN_TASK_EVENT_TYPE` kaynakli persisted legacy event engeli kapanmistir. Duzeltme strict contracti gevsetmiyor, uydurma event/progress uretmiyor, desktop ve encrypted mobile consumerlarda ayni sonucu veriyor ve gercek runtime DB'yi degistirmiyor.

**Genel branch/release karari: NOT_READY.** Kalan P1 ve dis runtime kabul engelleri tamamlanmadan production-ready veya master-accepted denmemelidir.
