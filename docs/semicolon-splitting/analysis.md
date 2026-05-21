# Analysis: Why the ; Split Breaks Compound Shell Constructs

## The Problem

The plugin uses `OPERATOR_RE` to split commands on `;`, `&&`, `||`, and `&`,
then prefixes each segment with `snip run --`. For independent commands this is
fine:

```
cmd1; cmd2               → snip run -- cmd1; snip run -- cmd2      ✓ works
cmd1 && cmd2             → snip run -- cmd1 && snip run -- cmd2    ✓ works
```

But for compound shell constructs, the `;` is **part of the syntax**, not a
command separator:

```
for f in a b c; do echo $f; done
```

After plugin processing:

```
snip run -- for f in a b c; snip run -- do echo $f; snip run -- done
```

The shell executes three independent commands:

1. `snip run -- for f in a b c` — snip tries to exec `for` as a program → FAILS
2. `snip run -- do echo $f` — snip tries to exec `do` as a program → FAILS
3. `snip run -- done` — snip tries to exec `done` as a program → FAILS

The loop never executes. The same applies to `while`, `if`, `case`, and any
compound construct that uses `;` internally.

## Why Removing ; From OPERATOR_RE Is Not Enough

Even if we stop splitting on `;`, the `;` remains in the command string. When
the plugin inserts `snip run -- ` at the start:

```
for f in a b c; do echo $f; done
→ snip run -- for f in a b c; do echo $f; done
```

The shell still interprets `;` as a separator:

1. `snip run -- for f in a b c` — snip execs `for` → FAILS
2. `do echo $f` — shell tries to run `do` → FAILS
3. `done` — shell tries to run `done` → FAILS

The `;` in the raw command string cannot be escaped by prefixing — it is
always a shell separator after the snip prefix.

## The Proper Fix

Commands containing unquoted `;` must be **left untouched** — no snip prefix
is applied. The command runs directly in the shell as the user intended.

This is safe because:
- Simple sequential commands (`cmd1; cmd2`) still work — just without snip filtering
- Compound constructs (`for...; do...; done`) work correctly
- The most common and filter-relevant commands (single commands, `&&` chains)
  are still prefixed

## How Native Hooks Avoid This

The snip native hooks (Claude Code via `snip hook`, Cursor, Pi) do NOT have
this issue because of two mechanisms:

### 1. Filter Registry Check

From `internal/hook/hook.go` lines 74-91:

```go
cmdSet := make(map[string]struct{}, len(commands))
for _, c := range commands { cmdSet[c] = struct{}{} }
if _, ok := cmdSet[base]; !ok {
    return nil  // no filter → pass through unchanged
}
```

The hook **only rewrites commands whose base command has a matching YAML
filter**. Shell keywords like `for`, `while`, `if` have no filters, so the
entire command passes through unchanged. The shell then executes it correctly.

### 2. First-Segment Extraction, Not Full Splitting

From `internal/hook/parse.go` lines 8-40:

```go
func ExtractFirstSegment(cmd string) string {
    // Stops at first unquoted ;, |, &, or newline
    // Only the first segment is examined; the rest is appended verbatim
}
```

When the hook DOES rewrite (e.g., `git log; echo done`), it extracts only
the first segment before `;`, wraps that in `snip run --`, and appends the
rest verbatim:

```
git log; echo done
→ /path/to/snip run -- git log; echo done
```

The `; echo done` part is not touched, so `echo done` runs directly in the
shell. This is safe because only the first command is filtered; subsequent
commands after `;` run unfiltered.

### Comparison

| Aspect | opencode-snip plugin (old) | snip native hook |
|--------|---------------------------|-----------------|
| When to prefix | ALL bash commands | Only commands with matching filters |
| `;` handling | Split on `;`, prefix each segment | Extract first segment only, rewrite if filtered |
| Compound constructs | BROKEN — `for`/`while`/`if` break | WORKS — pass through if no filter matches |
| Sequential commands | Both commands filtered | Only first command filtered |

## Impact

Removing `;` from the plugin's operator splitting means that in
`cmd1; cmd2; cmd3`, only `cmd1` gets snip-filtered (via `snip run -- cmd1; cmd2; cmd3`).
The remaining commands run unfiltered. This is an acceptable trade-off — the
alternative is breaking compound constructs entirely.
