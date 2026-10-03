# E.D.I.T.H. Mobile Foundation

Android 13+ companion client foundation. It consumes the frozen E.D.I.T.H. V2/V2.1 contract and does not implement desktop automation or backend policy.

## Toolchain

- JDK 17
- Android SDK Platform 35 and Build Tools
- Included Gradle 8.9 wrapper or Android Studio

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Set these in user-level Gradle properties or CI secrets, never in source control:

```properties
edith.mobile.apiBaseUrl=https://host.example
edith.mobile.realtimeUrl=wss://host.example/realtime
edith.mobile.certificatePins=sha256/BASE64_PIN,sha256/BACKUP_PIN
```

The app fails closed when endpoints, authenticated application-envelope encryption, device capability evidence, or certificate pins are unavailable. Debug builds may use an emulator-loopback HTTP endpoint only when explicitly supplied; release builds require HTTPS/WSS and pins.

No polling job is scheduled as a substitute for push. Android 13 notification consent is requested only when the owner turns on Smart Notifications in Settings. No broad storage, microphone, camera, screen-capture, boot receiver, wake-lock, or foreground-service permission is declared.

## Smart notifications

Accepted authenticated realtime completion/failure events for tasks and transfers produce Android notifications when opted in. Replay, out-of-order, older-than-five-minute and duplicate outcomes are suppressed. Only hashed outcome keys are persisted (bounded to 256); no task content, titles, file names, errors or credentials are logged in notification history. Preview is private/generic by default; lock-screen visibility is private. Quiet hours 22:00–08:00 use device-local time. Clicking opens Tasks or Transfers without executing a command. Revocation and local wipe clear delivered notices.

Background remote push is **not connected**: notifications work while the existing authenticated realtime client remains connected; Android may suspend it when the application is backgrounded. No claim of closed-app delivery, periodic polling or desktop-bot bridge is made. `DesktopBotNoticeV1` prepares an expiring, versioned completion/failure/reminder contract, but it is deliberately not registered on the current event stream until authenticated sender binding and backend support exist.

## Contract-ready surfaces

The foundation includes canonical parsing/reducers and honest disabled states for pairing, realtime task updates, device trust, transfers, remote view, Wake-on-LAN, clipboard, Ask My Computer, voice notes, and Emergency Stop. Network delivery remains unavailable until the backend publishes the authenticated mobile endpoint/envelope contract and a pairing proof algorithm compatible with Android Keystore-backed identities. Disabled surfaces do not synthesize devices, progress, capabilities, delivery receipts, or success states.
