# E.D.I.T.H. Desktop Setup

This note describes the current safe desktop shell state for E.D.I.T.H.

## Dev / Browser Mode

Run the local Express + Vite development server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

Browser mode keeps the React UI usable even when Tauri is not present. Desktop window controls are shown through the same UI, but they disable themselves when the Tauri shell is not detected.

## Tauri Dev Mode

After Rust/Cargo is installed and available in `PATH`, run:

```bash
npm run tauri:dev
```

The existing Tauri config runs the Vite frontend with:

```bash
npm run vite:dev
```

## Package Build Status

Tauri package build is currently blocked on this machine because Cargo is not available in `PATH`.

Observed failure:

```text
failed to run 'cargo metadata' command ... program not found
```

Install Rust/Cargo and ensure `cargo` is available from a new terminal session:

```bash
cargo --version
```

After Cargo is available, run these exact project commands:

```bash
npm run lint
npm run test:edith-interaction-safety
npm run build
npm run tauri:dev
npm run tauri:build
```

## Implemented Desktop Features

- E.D.I.T.H. Tauri app identity and window title.
- Frameless desktop shell configuration.
- Custom desktop title bar.
- Safe window controls: minimize, maximize, fullscreen, close.
- Desktop shell status bridge with browser-safe fallback.
- Startup boot screen with honest checks.
- System Diagnostics screen with desktop, provider, permission, kill switch, and capability status.
- Capability Review panel for computer, browser, voice, vision, and Mark-L boundaries.
- In-app keyboard shortcuts for safe UI actions only.

## Intentionally Not Implemented Yet

- Real computer control.
- Real device control.
- Screenshot or OCR capture.
- Wake word.
- Tray/background mode.
- Global OS-level shortcuts.
- Real browser form submission, upload, or download execution.
- Mark-L action execution.

## Current Safe Capability States

- Computer Use: `READ_ONLY`
- Browser Use: `READ_ONLY`
- Screenshot/OCR: Not enabled
- Wake word: Not enabled
- Global shortcuts: Not enabled
- Tray/background mode: Not enabled
- Real device control: Not enabled

High-risk local permission policy may be elevated by user settings, but the desktop interaction safety layer still reports read-only modes until a scoped approval and a verified runtime adapter are explicitly added.
