# Plugin Integration: opencode-snip

How this plugin integrates `snip run --` into the OpenCode tool execution pipeline.

## Architecture

```
OpenCode bash tool call
  └─ opencode-snip plugin (tool.execute.before hook)
       └─ snipCommand(): prefixes with "snip run -- "
       └─ Modified command sent to shell
            └─ snip binary executes (from PATH)
                 └─ matches filter registry by command name
                 └─ runs target command
                 └─ applies YAML filter pipeline
                 └─ outputs filtered text
```

## Current Prefix

```typescript
// src/index.ts
function snipCommand(command: string): string {
  const envPrefix = (command.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = command.slice(envPrefix.length).trim()
  if (!bareCmd) return command
  if (UNPROXYABLE_COMMANDS.has(bareCmd.split(/\s+/)[0])) return command
  return `${envPrefix}snip run -- ${bareCmd}`  // was "snip ${bareCmd}"
}
```

## Comparison with Other Integrations

### opencode-snip (this plugin)

| Property | Value |
| -------- | ----- |
| Integration point | `tool.execute.before` hook in OpenCode plugin API |
| Prefix form | `snip run -- <cmd>` |
| Configuration | None (all-or-nothing) |
| Tool scope | All bash commands (except unproxyable builtins) |
| Deny/block support | No |
| Context injection | No |
| PostToolUse hooks | No |

### snip native hooks (Claude Code, Cursor, Pi)

| Property | Value |
| -------- | ----- |
| Integration point | `PreToolUse` hook in agent settings.json |
| Prefix form | `snip run -- <cmd>` |
| Configuration | None (filtered by snip's registry) |
| Tool scope | Only commands with filters in registry |
| Deny/block support | Yes (exit code 2 = block) |
| Context injection | No |
| PostToolUse hooks | No |

### pi-hooks (@hsingjui/pi-hooks)

| Property | Value |
| -------- | ----- |
| Integration point | Pi extension via `pi.on("tool_call")` |
| Prefix form | User-defined hook command |
| Configuration | Full settings file (matcher, if conditions, timeouts) |
| Tool scope | Configurable per matcher regex |
| Deny/block support | Yes (`permissionDecision: "deny"`) |
| Context injection | Yes (`additionalContext`) |
| PostToolUse hooks | Yes (patch tool results) |

## Why `snip run --` Instead of `snip`

1. **No built-in collision** — `snip run -- config` proxies `/usr/bin/config` instead of showing snip's config
2. **Consistent with native hooks** — Claude Code, Cursor, and Pi hooks all generate `snip run --`
3. **Explicit boundary** — `--` makes it unambiguous where snip flags end and target command begins

See [edge-cases.md](edge-cases.md) for the full analysis.

## Future Improvements

- Add configuration for a command skip list (users who don't want certain commands filtered)
- Add `exclude_flags` support to skip filtering when specific flags are present
- Support per-project filter files (`.snip/filters/`)
