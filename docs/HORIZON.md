# Horizon (P5) — deferred roadmap

These items are **intentionally not implemented** until P0–P4 are stable in production.
They remain product options, not near-term engineering tasks.

## P5.1 — C++ rasterizer inside OBS (no Electron CEF frames)

Replace offscreen Chromium → SHM/TCP textures with an in-plugin compositor that draws
layers from a compact scene protocol. Months of C++/graphics work; risk of editor↔OBS drift.
**Do after** P1b shared-memory path is exhausted and profiling shows a hard ceiling.

## P5.2 — UI framework rewrite (React / Qt / …)

Vue 3 + Fluent shell already shipped (M7). A rewrite is a quarter+ of frozen features.
Prefer unifying `fluent-panel-*` CSS and EmptyState coverage instead.

## P5.3 — Mobile native app

Remote mods already use the browser + connector. Build **Perform mode** as a responsive
web/PWA first; only then consider Capacitor / store apps as a thin shell — not a full
EditorView port.

See also: project improvement plan (Cursor plans) phase P5.
