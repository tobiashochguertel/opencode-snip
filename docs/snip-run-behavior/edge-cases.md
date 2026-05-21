# Edge Cases: `snip <cmd>` vs `snip run -- <cmd>`

An exhaustive comparison of all edge cases between the two invocation forms,
based on analysis of snip's Go source at `edouard-claude/snip`.

## 1. Built-in Command Collision (Critical)

If the target command name matches a snip built-in subcommand, `snip <cmd>` silently hijacks it:

| snip builtin   | `snip <builtin>` | `snip run -- <builtin>` |
| -------------- | ---------------- | ----------------------- |
| `config`       | Shows snip's config (`case "config"`) | Proxies system `/usr/bin/config` |
| `init`         | Runs snip's `init` subcommand | Proxies system `init` |
| `proxy`        | Passes through unfiltered (`case "proxy"`) | Proxies and filters |
| `gain`         | Shows snip's token report | Proxies system `gain` |
| `hook`         | Starts snip's hook handler | Proxies system `hook` |
| `discover`     | Runs snip's `discover` | Proxies system `discover` |
| `learn`        | Runs snip's `learn` | Proxies system `learn` |
| `verify`       | Runs snip's `verify` | Proxies system `verify` |
| `trust`        | Runs snip's `trust` | Proxies system `trust` |
| `untrust`      | Runs snip's `untrust` | Proxies system `untrust` |
| `check`        | Runs snip's `check` | Proxies system `check` |
| `run`          | Falls to runPipeline as a command | Proxies system `run` |

**Mitigation:** `snip run --` always enters `case "run"` → `parseSeparatorArgs` → `runPipeline`, bypassing the built-in switch entirely (cli.go:59-209). An AI coding agent could legitimately generate any of these as system commands.

## 2. Flags Before `--`

`parseSeparatorArgs` (cli.go:215) requires `--` immediately after `run`:

```
snip run -- git log          OK
snip run git log             ERROR: "run requires -- separator"
snip run -v -- git log       ERROR: "unexpected arguments before -- (-v)"
snip -v run -- git log       OK (flag before run, not between run and --)
```

With `snip <cmd>`, flags before the command are always valid snip flags:
```
snip -v git log              OK (snip gets -v, git gets log)
snip -u git log              OK (ultra-compact mode)
```

For the plugin, flags are not used (the plugin doesn't set `-v` or `-u`), so this
is not a practical concern. The plugin generates the prefix string directly.

## 3. The `--` Separator in Target Command Arguments

If the target command itself contains `--` (e.g., `git diff --cached`):

| Form | Behavior |
| ---- | -------- |
| `snip git log --oneline -v` | `ParseFlags` hits `git` in `default` case, returns immediately. `--oneline` stays in cmdArgs. **Correct.** |
| `snip run -- git log --oneline -v` | `parseSeparatorArgs` finds `--` at index 0, everything after is target: `["git", "log", "--oneline", "-v"]`. **Correct.** |

Both forms handle this correctly, but via different mechanisms:
- `snip <cmd>` because `ParseFlags` short-circuits on the first non-flag, non-builtin arg
- `snip run --` because `parseSeparatorArgs` only looks for the first `--` which separates snip from target

**Potential pitfall**: If a command argument literally equals `"--"`:
- `snip run -- -- arg` → targetCmd = `"--"`, targetArgs = `["arg"]`
- `snip -- arg` → `ParseFlags` hits `--`, everything after goes to `remaining`. targetCmd = `"arg"`. Different!

This is a known edge: with `snip run --`, a command named `--` is valid; with `snip <cmd>`, a bare `--` stops flag parsing and makes the next token the command. In practice, no one runs a command called `--`.

## 4. Environment Variable Prefixes

```
FOO=bar snip cmd
  → Plugin produces: FOO=bar snip run -- cmd
  → Shell sets FOO=bar, snip gets run -- cmd
  → OK

FOO=bar snip run -- cmd
  → Same as above
  → OK
```

Both work identically. The shell processes env vars before executing snip.

## 5. Operators (&&, ||, ;, &)

The plugin handles these at the TypeScript level by splitting on `OPERATOR_RE`
and prefixing each segment:

```typescript
const OPERATOR_RE = /(\s*(?:&&|\|\||;)\s*|\s&\s?)/
```

With `snip run --`, the output changes from:
```
snip cmd1 && snip cmd2          // current
```
to:
```
snip run -- cmd1 && snip run -- cmd2   // new
```

The operator splitting logic itself is unchanged — only the prefix template changes.

## 6. Pipes (|)

The plugin only snip-prefixes the first command before a pipe:

```typescript
if (findFirstPipe(command) !== -1) {
    const firstCmd = command.slice(0, pipeIdx).trimEnd()
    const rest = command.slice(pipeIdx)
    output.args.command = snipCommand(firstCmd) + ' ' + rest
}
```

| Current | New |
| ------- | --- |
| `snip git log \| grep foo` | `snip run -- git log \| grep foo` |

The pipe split logic reads `findFirstPipe` which correctly handles quoted pipes
(single quotes, double quotes), so `jq '.a \| .b'` is not split.

## 7. Redirections (2>&1, etc.)

Redirections are shell syntax, not snip syntax. snip receives the entire command
string and passes it to the shell via `bash -c`. The plugin just prefixes:

| Current | New |
| ------- | --- |
| `snip find / -name "*.log" 2>&1` | `snip run -- find / -name "*.log" 2>&1` |

The shell handles the redirection in both cases.

## 8. Unproxyable Commands

The plugin checks `UNPROXYABLE_COMMANDS` (cd, source, export, etc.) and skips them.
This behavior is unchanged by the `snip run --` switch.

## 9. Already-prefixed Commands

The plugin checks `command.startsWith("snip ")` and skips modification. Both
`snip cmd` and `snip run -- cmd` start with `"snip "`, so the skip works for both.
Manual `snip run -- cmd` in an AI prompt won't be double-prefixed.

## Summary

| Edge case | `snip <cmd>` | `snip run -- <cmd>` |
| --------- | ------------ | ------------------- |
| Command collides with snip builtin | Hijacked to snip subcommand | Proxied correctly |
| `-v`/`-u` flags | `snip -v cmd` works | Must be before `run`: `snip -v run -- cmd` |
| `--` inside command args | Works (ParseFlags short-circuits) | Works (separator at index 0) |
| Env var prefix | Works | Works |
| Operators (&&, \|\|, ;, &) | Plugin handles | Plugin handles (same split logic) |
| Pipes | Plugin handles (first cmd only) | Plugin handles (same) |
| Redirections | Passed to shell | Passed to shell |
| Unproxyable builtins | Skipped | Skipped |
| Manual `snip run -- cmd` | Skipped (starts with "snip ") | Skipped (starts with "snip ") |
