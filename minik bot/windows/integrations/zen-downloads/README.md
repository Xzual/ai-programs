# Zen Browser downloads adapter

This is an **opt-in** Firefox-compatible WebExtension and native messaging host, not an installed integration. No browser profile, registry or browser permissions have been changed automatically. Without installation the bar reports `bridge_required`; expired samples report `disconnected`, with no stale progress.

Permissions: `downloads` reads download metadata; `nativeMessaging` communicates with this specific local host over stdin/stdout. No network listener, URLs, referrers, full file paths, cookies, browsing history or remote service are used. Only active downloads and downloads whose completion was observed during this extension session are sent. Private/incognito downloads are excluded. This adapter never starts, pauses or deletes downloads.

## Installation requiring user approval

1. Build the local host from `windows`: `cargo build --manifest-path src-tauri/Cargo.toml --bin zen-download-host --release`.
2. Copy `native-host.example.json` to a stable location, replace its `path` with the absolute built `zen-download-host.exe` path.
3. With explicit approval, register that manifest's absolute path as the default value under the per-user registry key `HKCU\Software\Mozilla\NativeMessagingHosts\fr.louisraille.coucou.downloads`. Do not replace other host registrations. This does not change any security policy.
4. For local testing in Zen open `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, select this directory's `manifest.json`. Temporary addons disappear on browser restart. Permanent installation requires a signed Firefox-compatible addon; do not disable signature checks.
5. The addon toolbar badge `!` means host disconnected. Click it to retry. Start a normal user-approved download; the bar receives byte counters every two seconds. Unknown totals/speed/ETA remain unknown.

### Packaged-editor AppData visibility

Windows packaged editors may expose redirected AppData/registry views to their child processes. The real Zen parent-process console is authoritative: if it says a registered manifest file does not exist, a successful editor-side `Test-Path` is not proof the browser can read it.

For this machine's development installation, `native-host.installed.json` points directly to the release host in this checkout, and `register-local-host.reg` registers that workspace manifest. The user must import the registration from normal Windows Explorer and handle any Windows warning themselves. These two installation files are machine-specific, not portable templates. Keep this checkout and the release executable in place while using this registration.

The optional `zen-download-setup.exe` (build it together with the host) copies the host and manifest to normal local AppData and registers only the Coucou key. It must be launched by the user from normal Windows Explorer, not from a potentially redirected packaged-editor context; launching it from Computer Use did not resolve this machine's visibility issue. Installation success has to be verified by real native host traffic, not the installer's exit code.

Uninstall by removing only this addon and its exact native-host registration. The host's snapshot is `%LOCALAPPDATA%\Coucou\zen-downloads.json`; it contains names and counters but no URLs or full paths. Remove that exact file if desired.

Native messaging reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging

Download metadata reference: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/DownloadItem

## Steam adapter

Steam detection uses the current user's `SteamPath` registry value (read-only), then the standard Program Files installation. Every library is discovered through `steamapps/libraryfolders.vdf`. Game counters come from each `appmanifest_*.acf`; no Steam settings are changed. Installed historical rows are not shown as fresh completions. Completion is emitted only after this process observed a queued/downloading/installing state and then a fully-installed manifest with equal total/received bytes. Workshop downloads are explicitly excluded: their separate log counters are not conflated with game downloads.

Speed and ETA are derived only from increasing counters in the same transfer, not elapsed timers or network traffic. Steam manifest counters update less frequently than Steam UI; therefore speed/ETA may be temporarily unknown. ETA estimates **network transfer remaining**, not Steam patching/unpacking duration. Steam's undocumented ACF source is bounded and fail-closed on inconsistent counters; future source changes may produce degraded status.
