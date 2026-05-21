# snip run-behavior

This directory documents the differences between `snip <cmd>` and `snip run -- <cmd>`, the safety analysis that led to preferring `snip run --`, and how this plugin integrates with snip's architecture.

## Files

- [architecture.md](architecture.md) — How snip dispatches commands internally, with call-graph traces for both invocation forms
- [edge-cases.md](edge-cases.md) — Exhaustive edge-case comparison between the two forms
- [plugin-integration.md](plugin-integration.md) — How this plugin uses `snip run --` and how it compares to other snip integrations
