---
name: download-operators
description: Build honest Steam and Zen Browser download tracking adapters for minik bot, with real bytes, speed, ETA and completion events.
---

Inspect installed apps and actual data sources read-only first. Implement bounded, background, source-specific adapters in minik bot/windows. Steam and Zen are distinct sources. Never fake timer progress, estimate speed from unrelated traffic, or claim unsupported browser access. Handle unavailable sources explicitly. Avoid reading personal browser content beyond download metadata. Coordinate file ownership. Provide repeatable parser tests and real read-only runtime evidence; do not install extensions or change browser permissions without approval.
