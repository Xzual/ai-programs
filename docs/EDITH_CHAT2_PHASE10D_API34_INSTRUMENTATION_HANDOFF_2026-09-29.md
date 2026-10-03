# E.D.I.T.H. Chat 2 Phase 10D API 34 Instrumentation Handoff

**Date:** 2026-09-29  
**Owner:** Chat 2 - Android consumer / instrumentation acceptance  
**Scope:** Pixel_8_Pro API 34 `connectedDebugAndroidTest` timeout diagnosis and fresh acceptance  
**Result:** **PASS — fresh 4/4 connected instrumentation tests**

## 1. Summary

The Phase 8D/Phase 9 `ShellCommandUnresponsiveException` blocker is closed for the scoped API 34 acceptance run.

- A fresh Pixel_8_Pro Android 14/API 34 emulator session completed all 4 connected tests.
- The app APK and androidTest APK were freshly rebuilt, installed, exercised, and uninstalled.
- The 49 JVM tests, lint, debug APK, and release APK matrix also passed.
- No mobile product source, Gradle configuration, assertions, allowlist, Crypto, Mark-L, SDK, or user AVD file was changed.
- The real `.edith/edith.db` file was unchanged.

## 2. Prior Failure Evidence

The Phase 8D daemon log `daemon-35128.out.log` shows the earlier failure before APK installation or instrumentation startup:

```text
[PropertyFetcher]: ShellCommandUnresponsiveException getting properties for device emulator-5554
Caused by: com.android.ddmlib.ShellCommandUnresponsiveException
at com.android.ddmlib.PropertyFetcher$1.run(PropertyFetcher.java:209)
```

`PropertyFetcher` issues the complete shell property query (`adb shell getprop`); the failure was not tied to one individual Android property.

## 3. Root Cause Classification

The failure was a host/emulator readiness race, not a test assertion or application defect.

| Layer | Finding |
|---|---|
| Emulator boot/readiness | **Root cause.** The emulator appeared as ADB `device` while `sys.boot_completed` was still empty and `init.svc.bootanim` was still `running`. |
| ADB server | Healthy after readiness. Platform-tools/ADB 37.0.0 returned device state and shell commands normally. |
| Gradle/ddmlib | The earlier exception occurred in ddmlib `PropertyFetcher`; after the readiness gate, the same path did not fail. |
| Shell property query | Two complete post-boot `adb shell getprop` probes returned 530 lines in 391 ms and 302 ms. |
| Animation/lockscreen | Before readiness, boot animation was running and keyguard was showing. After boot completion, animations were disabled and keyguard dismissed only inside the read-only emulator session. |
| APK install / runner | Both APKs installed; AndroidJUnitRunner started; all 4 tests completed; both packages were uninstalled. |
| Resource contention | WHPX was installed and usable; approximately 20 GB physical memory was free. No resource starvation was observed during the passing run. |

The AVD was launched with `-read-only -no-snapshot-save`; session settings did not persist to the user's AVD.

## 4. Reproduction and Acceptance Sequence

The first diagnostic wrapper attempt used `Start-Process` with a Windows batch file. Its argument flattening invoked Gradle `help`, not `connectedDebugAndroidTest`; it is explicitly excluded from acceptance evidence. Its retained output is named `invalid-harness-gradle-help-output.log` to prevent misinterpretation.

The valid bounded sequence was:

1. Launch `Pixel_8_Pro` with `-read-only -no-snapshot-save -no-window -no-audio`.
2. Observe ADB `device` while `sys.boot_completed` was empty and boot animation was `running`.
3. Wait until ADB state was `device`, `sys.boot_completed=1`, and `init.svc.bootanim=stopped`.
4. Require two successful complete `getprop` probes.
5. Disable animations and dismiss keyguard inside the ephemeral emulator session.
6. Run `:app:connectedDebugAndroidTest --no-daemon --rerun-tasks --info --stacktrace`.

No retry of the valid connected test was needed.

## 5. Connected Test Result

Device: `Pixel_8_Pro(AVD) - 14`, API 34.

| Test | Result |
|---|---:|
| `AndroidKeystoreP256Test.createsSeparateSigningAndAgreementKeysWithoutSoftwareFallback` | PASS |
| `MobileSmokeTest.handoffScreenShowsHonestUnavailableState` | PASS |
| `MobileSmokeTest.honestUnconfiguredHomeIsVisible` | PASS |
| `MobileSmokeTest.pairingScreenDoesNotRequestOrExposeASecret` | PASS |

XML result: 4 tests, 4 passed, 0 failures, 0 errors, 0 skipped.  
Evidence copy: `artifacts/phase10d-api34/api34-instrumentation-results.xml`  
Evidence SHA-256: `46D1E2685818AA0070002535FA43363197534553544B5499E07A11FFE1708E22`

## 6. Android Build Matrix

Command:

```text
gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleRelease --no-daemon --rerun-tasks
```

Results:

- JVM: 49 tests, 0 failures, 0 errors, 0 skipped.
- Lint: PASS; 0 errors and 7 existing warnings.
- Debug APK: PASS, 59,446,531 bytes, generated `2026-09-29T00:31:09+03:00`.
- Release APK: PASS, unsigned as expected, 3,318,344 bytes, generated `2026-09-29T00:34:24+03:00`.
- Existing native-library strip warning for `libandroidx.graphics.path.so` remains non-fatal.

## 7. Repo Change Decision

No repo-owned runner or Gradle fix was applied because the root cause was outside application/test code:

- Current tests pass unchanged once Android reports complete boot readiness.
- Assertions were not weakened, skipped, retried, or replaced.
- No hardcoded Android SDK path or `local.properties` file was added.
- `ANDROID_HOME` and `ANDROID_SDK_ROOT` were set only in command scope.
- The existing project-level mobile owner and security-auditor subagent definitions were sufficient; no redundant agent definition was created.

Future CI/manual runners should gate on all three conditions before invoking Gradle: ADB `device`, `sys.boot_completed=1`, and `init.svc.bootanim=stopped`, followed by a bounded complete `getprop` probe.

## 8. Security and Scope Preservation

- Advanced mobile projection still rejects `mutationAvailable=true` via `ADVANCED_MOBILE_READ_ONLY_REQUIRED`.
- The mobile UI still presents advanced mutation as `read only`.
- No mutation command was added to the mobile allowlist.
- Crypto and Mark-L were not edited or executed.
- No credential, API key, certificate pin, or user path was added to source.

## 9. Persistence Gate

The real runtime database was measured before and after all work.

| Property | Before | After |
|---|---|---|
| SHA-256 | `3EE2E2DCF762A4DDB91B48891AF4B690ACF94C59E69D15C13E3396E7D368DCFF` | Same |
| Size | 53,260,288 bytes | Same |
| UTC mtime | `2026-09-28T20:46:57.5863204Z` | Same |

Result: `sourceRuntimeDatabaseUnchanged: true`.

## 10. Process Cleanup

Only processes started by Phase 10D were stopped:

- emulator PID 26580
- ADB server PID 8744
- diagnostic Gradle daemon PID 25684
- single-use Gradle daemons exited after their builds

Final process inspection found no remaining ADB, emulator, qemu, Gradle, or task-owned Kotlin daemon process.

## 11. Files Changed

- `docs/EDITH_CHAT2_PHASE10D_API34_INSTRUMENTATION_HANDOFF_2026-09-29.md`
- `artifacts/phase10d-api34/boot-readiness.json`
- `artifacts/phase10d-api34/api34-instrumentation-results.xml`
- `artifacts/phase10d-api34/repro-emulator.stdout.log`
- `artifacts/phase10d-api34/repro-emulator.stderr.log`
- `artifacts/phase10d-api34/invalid-harness-gradle-help-output.log` (explicitly non-evidence)

No product source or build configuration was intentionally changed.

## 12. Remaining Limitations

- This closes only the fresh API 34 connected instrumentation blocker.
- API 33/API 35 connected runtime and physical-device acceptance remain outside this scope.
- Windows signing, physical mobile pairing, real Computer Use/Browser, Obsidian first-run, and other Phase 9 release blockers remain open.
- The existing Android release APK remains unsigned; this run does not claim production distribution readiness.

## 13. Decision

**Phase 10D API 34 connected instrumentation: PASS, 4/4 fresh.**

The previous property timeout is classified as an emulator boot-readiness race. The scoped blocker is closed without source changes or reduced test coverage; the overall product release decision remains governed by the other Phase 9 blockers.
