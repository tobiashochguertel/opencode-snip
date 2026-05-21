# Fix: Remove ; from Operator Splitting

## Changes

### 1. Remove `;` and `&` from `OPERATOR_RE`

```typescript
// Before:
const OPERATOR_RE = /(\s*(?:&&|\|\||;)\s*|\s&\s?)/
// After:
const OPERATOR_RE = /(\s*(?:&&|\|\||)\s*)/
```

Only `&&` and `||` remain. `;` and `&` are no longer split.

### 2. Add Semicolon Detection

A function to detect unquoted `;` in the command string:

```typescript
function containsUnquotedSemicolon(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      return true
    }
  }
  return false
}
```

### 3. Skip Prefixing for Commands with Unquoted `;`

In `toolExecuteBefore`, before processing:

```typescript
// Commands with unquoted ; contain compound shell constructs
// (for, while, if, case). Prefixing with snip would break them.
if (containsUnquotedSemicolon(command)) return
```

## Behavior After Fix

| Command | Before | After |
|---------|--------|-------|
| `for f in a b c; do echo $f; done` | **BROKEN** — segments fail separately | **WORKS** — passes through, no snip prefix |
| `cmd1; cmd2` | Both filtered separately | **WORKS** — passes through, no snip prefix |
| `cmd1 && cmd2` | Both filtered | Both filtered (unchanged) |
| `git log` | Filtered by snip | Filtered by snip (unchanged) |
| `cd /tmp && ls` | cmd1 skipped, cmd2 filtered | cmd1 skipped, cmd2 filtered (unchanged) |

## Trade-Off

Commands with unquoted `;` lose snip filtering. This is an acceptable trade-off:
- Compound constructs (`for`, `while`, `if`) are the primary case — they MUST
  pass through to work at all
- Simple sequential commands (`cmd1; cmd2`) losing filtering is minor — they
  are usually post-processing steps (e.g., `make build; echo done`)
- The most common and valuable filter targets (single commands, `&&` chains)
  are unaffected
