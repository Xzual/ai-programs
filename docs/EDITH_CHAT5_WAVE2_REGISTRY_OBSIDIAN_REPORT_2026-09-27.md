# E.D.I.T.H. Chat 5 Wave 2 Registry / Obsidian / Knowledge Map Report

Tarih: 27 Eylul 2026

## Karar

- Chat 5 sahiplik alani: **PASS**
- Genel release: **FAIL / RELEASE BLOCKED**
- Internal critical blocker (Chat 5 sahiplik alani): **YOK**
- Cross-team integration: **TAMAMLANDI**. Chat 2 canonical 34/31 registry ayrimini, Knowledge Map `dataStatus` gorunumunu ve `ownerMutationFetch` entegrasyonunu tamamladi. Chat 4 protected route kabulunu ve backend-security cleanup duzeltmesini tamamladi.
- External configuration blocker: Yetkili checkout workspace config'inde `obsidianVaultPath` bostur; gercek kullanici vault'u secilmeden Obsidian **configuration_required** kalir.

## Canonical Registry

Tek calistirma otoritesi `edithToolRegistry` (`src/edith/serverRegistry.ts`) olarak sabitlendi.

- Canonical executable tools: **34**
- Permission acisindan enabled: **30**
- Permission acisindan blocked: **4**
- Approval required / high risk: **13**
- Risk dagilimi: READ 5, LOW 13, MEDIUM 4, HIGH 6, CRITICAL 6
- Health dagilimi: HEALTHY 6, DEGRADED 24, UNAVAILABLE 4
- Canonical skills: **14**
- Planning capabilities: **31**; bunlar `kind: planning_abstraction`, `executable: false` olarak acikca etiketlidir ve executable tool sayimina dahil degildir.

`GET /api/edith/tools` artik `schemaVersion`, `authority`, `checkedAt`, `tools`, `health`, `counts` ve ayri `planningCapabilities` alanlarini dondurur. Eski ikinci `registryTools` listesi kaldirildi. `GET /api/edith/capabilities` ve `/summary` ayni canonical tool snapshot/count kaynagini kullanir.

## Yapilan Degisiklikler

- `src/edith/serverRegistry.ts`: canonical registry snapshot, risk/state/count sozlesmesi.
- `src/edith/toolRegistry.ts`: capability tanimlari calistirilabilir arac degil, planlama soyutlamasi olarak etiketlendi.
- `server/routes/skills.ts`: Skills API gercek registry ve deterministik sayimla baglandi.
- `server/routes/workspace.ts`: workspace mutasyonlari owner-session + same-origin + CSRF ile korundu.
- `server/routes/knowledge.ts`: Obsidian/knowledge yazma, sync, reindex, settings ve vault mutasyonlari ayni korumaya baglandi; owner audit olaylari yerel vault yolunu ifsa etmeden kaydediliyor.
- `src/edith/workspaceManager.ts`: config ve metadata yazilari temp + rollback backup kullanan atomik yazima gecti.
- `src/edith/obsidianVaultService.ts`: note/index yazilari atomik ve geri alinabilir; lexical containment, real-path containment ve symlink target reddi eklendi.
- `src/edith/knowledgeGraphService.ts`: yapilandirilmamis Obsidian vault dugumu uretilmiyor; stale vault dugumu soft-delete ediliyor.
- `src/edith/knowledgeMapService.ts`: sahte `agent-hub`/`model-router` dugumleri kaldirildi; `dataStatus` ile ready/degraded/empty ve Obsidian nedeni raporlaniyor.
- `scripts/test-edith-skills.ts`, `scripts/test-edith-workspace.ts`, `scripts/test-edith-obsidian-knowledge.ts`, `scripts/test-edith-knowledge-map.ts`: canonical sayim, owner auth, Unicode path, atomik yazim, containment ve honest degraded regresyonlari.
- `scripts/test-edith-recovery.ts`, `scripts/test-edith-task-queue.ts`, `scripts/test-edith-verifier.ts`: guncel lifecycle sozlesmesini literal degisikligi yerine gercek persisted state, resume, inline verification ve audit kanitiyla test eder; SQLite store her durumda kapanir.

## Task Lifecycle Handoff Kaniti

- Premature verification, `PLANNING` gorevi degistirmeden ve verification/audit kaydi uretmeden reddedilir.
- Gecerli retry yolu `RUNNING` + terminal plan adimlariyla verifier'a girer; eksik gercek tool kaniti `RETRYABLE` verification kaydi ve kalici `BLOCKED` durumu uretir.
- Recovery bu kaydi `VERIFICATION_RETRYABLE` olarak siniflandirir, `RECOVERING` gecisini kaydeder ve yeni planla gorevi `QUEUED` durumuna alir.
- Queue pause `BLOCKED` + `queue.state=resumable` + `resumeFromStepId` olarak kalici yazilir; resume tamamlanmis adimlari koruyarak ayni checkpoint'ten `QUEUED` olur.
- Executor terminal adimlardan sonra verifier'i inline calistirir; PASS verification, timeline ve audit kalici yazildiktan sonra `COMPLETED` doner. Tamamlanmis gorevde ikinci verify denemesi yeni kayit uretmez.
- Kok neden: testler kaldirilmis gecici `PAUSED`, `RETRYING` ve executor-sonrasi ayri `VERIFYING` durumlarini bekliyordu; ayrica SQLite cleanup yalniz basarili assertion yolunda calisiyordu. Fixture'lar durable `BLOCKED/resumable`, verifier kaydi ve executor-inline verification sozlesmesine tasindi; store kapanisi `finally` ile deterministik hale getirildi.
- Bu handoff icin urun kodu degisikligi gerekmedi; kaynak sozlesmesi dogru, eski test fixture'lari guncellendi.

## Gercek Olanlar

- Tool listesi gercek execution registry kayitlarindan gelir; permission kararlari server-owned permission service tarafindan hesaplanir.
- Skills API 14 built-in skill'in canli provider/workspace/Obsidian/crypto durumunu kullanir.
- Knowledge Map kalici task, memory, audit, tool, agent ve gercek indekslenmis Obsidian verisini kullanir.
- Workspace ve Obsidian pathleri config/env tabanlidir; Turkce Unicode ve bosluk iceren Windows yollarinda test edilmistir.
- Obsidian note yazimi secret redaction, audit/sync event, containment ve atomik replace uygular.
- High-risk araclar permission olmadan bloklanir; registry health bunu `UNAVAILABLE` olarak gosterir.

## Stub / Configuration Required

- 31 planning capability executable agent/tool degildir.
- Skill Store community install/execute, File Organizer ve Release Builder halen planned/configuration_required davranir.
- Mark-L yalniz metadata capability snapshot sunar; sandboxed adapter yoktur ve execution kapali kalir.
- Awesome Agent Skills icindeki dis servis entegrasyonlari adapter/config/permission yoksa guard veya degraded durumundadir.
- Obsidian bu makinede gercek vault secilmedigi icin configuration_required; Knowledge Map bunu fake vault verisiyle gizlemez.
- Embedding provider yoksa RAG lexical retrieval calisir ve embedding durumu `embedding_provider_required` olarak raporlanir.

## Testler

- `npm run test:edith-registry` - PASS
- `npm run test:edith-skills` - PASS; 14 skills, 31 planning capabilities, 34 canonical tools
- `npm run test:edith-knowledge-map` - PASS; 58 nodes, 111 edges, no synthetic map nodes
- `npm run test:edith-workspace` - PASS; Unicode/Turkish/spaces, atomic config, protected mutations, path-safe owner audit
- `npm run test:edith-obsidian-knowledge` - PASS; 19 senaryo, atomic write + containment
- `npm run test:edith-permission-service` - PASS
- `npm run test:edith-capabilities` - PASS
- `npm run test:edith-recovery` - PASS; valid retryable verify -> BLOCKED -> REPLAN/QUEUED
- `npm run test:edith-task-queue` - PASS; BLOCKED/resumable persistence -> resume
- `npm run test:edith-verifier` - PASS; premature reject + executor-integrated PASS/COMPLETED + single audit
- `npm run test:edith-task-service` - PASS
- `npm run test:edith-planner` - PASS
- `npm run test:edith-executor` - PASS
- `npm run lint` - PASS
- `npm run build` - PASS; yalniz mevcut 500 kB Vite chunk uyarisi
- Scoped `git diff --check` - PASS; yalniz LF/CRLF uyari mesaji
- `npm run test:edith-backend-security` - **15/15 PASS**; Chat 4 Windows SQLite cleanup ve protected workspace/Obsidian route kabulunu tamamladi.

## Riskler

- 24 arac external dependency bildirdigi icin `DEGRADED`; bu durum calistirilabilirlik kaniti degildir.
- Gercek Obsidian vault kabul testi kullanici vault'u secilmeden yapilamaz.

## Tamamlanan Cross-Team Entegrasyon

- Chat 2: Tools ekrani `counts.total=34` canonical executable tool ve 31 `planningCapabilities` ayrimini kullaniyor; local 49-item union kaldirildi.
- Chat 2: Knowledge Map `map.dataStatus.state`, `reasons`, `obsidian` ve `syntheticNodes` alanlarini gosteriyor.
- Chat 2: Workspace/Obsidian mutasyonlari memory-only CSRF kullanan ortak `ownerMutationFetch` uzerinden gidiyor.
- Chat 4: Skills, Knowledge ve Workspace protected route'lari owner-session + same-origin + CSRF ile kabul edildi; backend-security 15/15 PASS ve Windows cleanup sorunu kapandi.
- Chat 8 final rerun: Jev fixture'i ortamdan bagimsiz hale getirildi. Config yoksa `config_required`, provider yapilandirilmis ama guncel availability kaniti yoksa `degraded`; iki durumda da `readiness.ready=false` ve `ready` yasak. `configured/available` details alanlari status ile capraz dogrulaniyor; tarihsel `lastProviderContact` tek basina readiness uretmiyor. Obsidian `config_required` assertion'i ayri ve degismeden kaldi.

## Chat 8 Handoff

- Release auditinde canonical tool sayisini 34 kabul et; 31 planning capability ayri ve non-executable siniftir.
- Chat 2 registry/dataStatus/auth ve Chat 4 protected-route/security-cleanup entegrasyonlarini acik risk olarak yeniden yazma; tamamlanmis cross-team kanitidir.
- Gercek Obsidian vault secimi halen ortam/yapilandirma kabul kosuludur; urun fake graph gostermeden `configuration_required/degraded` raporlar.

Bu tur commit, push, reset veya ilgisiz dirty-tree geri alma islemi yapmadi.
