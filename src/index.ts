import { Plugin } from "@opencode/plugin"
import { spawnSync } from "node:child_process"

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|\\.|[^\s'"\\])* +)*/
const UNPROXYABLE_COMMANDS = new Set([
  "cd", "source", ".", "export", "alias", "unset", "set", "shopt", "eval", "exec",
])
const OPERATOR_RE = /^\s*(?:&&|\|\|)\s*$/

function findFirstPipe(command: string): number {
  let inSingleQuote = false
  let inDoubleQuote = false
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      if (command[i + 1] === '|' || (i > 0 && command[i - 1] === '|')) {
        i++
        continue
      }
      return i
    }
  }
  
  return -1
}

function splitOnUnquotedOperators(command: string): string[] {
  const segments: string[] = []
  let inSingleQuote = false
  let inDoubleQuote = false
  let start = 0
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (!inSingleQuote && !inDoubleQuote && (command.startsWith("&&", i) || command.startsWith("||", i))) {
      let opStart = i
      while (opStart > start && /\s/.test(command[opStart - 1])) opStart--
      let opEnd = i + 2
      while (opEnd < command.length && /\s/.test(command[opEnd])) opEnd++
      segments.push(command.slice(start, opStart), command.slice(opStart, opEnd))
      start = opEnd
      i = opEnd - 1
    }
  }
  segments.push(command.slice(start))
  return segments
}

function containsUnquotedSeparator(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if ((char === ';' || char === '\n') && !inSingleQuote && !inDoubleQuote) {
      return true
    }
  }
  return false
}

function snipCommand(command: string): string {
  const envPrefix = (command.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = command.slice(envPrefix.length).trim()
  if (!bareCmd) return command
  if (UNPROXYABLE_COMMANDS.has(bareCmd.split(/\s+/)[0])) return command
  return `${envPrefix}snip run -- ${bareCmd}`
}

export interface ExecuteBeforeEvent {
  tool: string
  input: { command?: unknown }
}

export const toolExecuteBefore = (event: ExecuteBeforeEvent): void => {
  // OpenCode v2 renamed the `bash` tool to `shell`; accept both.
  if (event.tool !== "bash" && event.tool !== "shell") return

  const args = event.input
  const command = args.command
  if (!command || typeof command !== "string") return
  if (command.startsWith("snip ")) return
  if (containsUnquotedSeparator(command)) return

  if (findFirstPipe(command) !== -1) {
    const pipeIdx = findFirstPipe(command)
    const firstCmd = command.slice(0, pipeIdx).trimEnd()
    const rest = command.slice(pipeIdx)
    args.command = snipCommand(firstCmd) + ' ' + rest
    return
  }

  const segments = splitOnUnquotedOperators(command)

  if (segments.length === 1) {
    args.command = snipCommand(command)
    return
  }

  args.command = segments
    .map((segment) => OPERATOR_RE.test(segment) ? segment : snipCommand(segment))
    .join("")
}

export default Plugin.define({
  id: "snip",
  setup(ctx) {
    const check = spawnSync("which", ["snip"], { stdio: "ignore" })
    if (check.error || check.status !== 0) {
      console.warn("[snip] snip binary not found in PATH — plugin disabled")
      return
    }

    void ctx.tool.hook("execute.before", (event) => {
      toolExecuteBefore(event as ExecuteBeforeEvent)
    })
  },
})
