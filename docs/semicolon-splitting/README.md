# Semicolon Splitting Issue

This directory documents why the plugin must NOT split on `;` and how the
native snip hooks avoid this problem entirely.

## Files

- [analysis.md](analysis.md) — How the `;` split breaks compound shell constructs and comparison with native hooks
- [fix.md](fix.md) — The fix applied to this plugin
