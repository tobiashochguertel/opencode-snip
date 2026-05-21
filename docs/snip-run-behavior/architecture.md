# Architecture: snip Command Dispatch

This document traces how snip processes the two invocation forms through its Go source code.

## Entry Point

Both forms enter through `cli.Run()` in `internal/cli/cli.go`. The call flow splits on how `ParseFlags` and the subsequent `switch` statement handle the first positional argument.

## `snip <cmd>`

```
snip git log
  └─ cli.Run(args)                           // args = ["snip", "git", "log"]
       └─ ParseFlags(["git", "log"])           // flags.go:18
            └─ i=0, arg="git":
                 isBuiltInCommand("git") → false
                 default: remaining = ["git", "log"], return
       └─ command = "git", cmdArgs = ["log"]
       └─ unproxyableReason("git") → ""       // not a builtin
       └─ switch "git":
            no case matches
       └─ runPipeline("git", ["log"], flags)   // cli.go:212
```

## `snip run -- <cmd>`

```
snip run -- git log
  └─ cli.Run(args)                           // args = ["snip", "run", "--", "git", "log"]
       └─ ParseFlags(["run", "--", "git", "log"])  // flags.go:18
            └─ i=0, arg="run":
                 isBuiltInCommand("run")? yes
                 isInfoFlag("--")? no  ("--" is not "--help" or "--version")
                 default: remaining = ["run", "--", "git", "log"], return
       └─ command = "run", cmdArgs = ["--", "git", "log"]
       └─ unproxyableReason("run") → ""       // not a shell builtin
       └─ switch "run":                        // cli.go:177
            case "run":
              parseSeparatorArgs(["--", "git", "log"], "run")  // cli.go:215
                └─ sepIdx = 0  (found "--" at index 0)
                └─ sepIdx > 0? no
                └─ after = ["git", "log"]
                └─ returns "git", ["log"], ""
              └─ unproxyableReason("git") → ""
              └─ runPipeline("git", ["log"], flags)  // cli.go:187
```

Both reach `runPipeline` with identical arguments. The `runPipeline` function (in `internal/engine/pipeline.go`) then:

1. Loads config and filters
2. Matches the command against the filter registry by `(command, subcommand, args)`
3. Injects configured args if the filter specifies `inject`
4. Executes the command with `Execute(command, finalArgs)`
5. Applies the filter pipeline actions on the captured output
6. Tracks token savings
7. Saves full output via tee if configured

## The `parseSeparatorArgs` function

```go
func parseSeparatorArgs(args []string, cmdName string) (string, []string, string) {
    sepIdx := -1
    for i, a := range args {
        if a == "--" { sepIdx = i; break }
    }
    if sepIdx < 0 {
        return error // "--" required
    }
    if sepIdx > 0 {
        return error // no args allowed before "--"
    }
    after := args[sepIdx+1:]
    if len(after) == 0 {
        return error // command required after "--"
    }
    return after[0], after[1:], ""
}
```

Key strictness: `sepIdx` must be exactly 0. No arguments are permitted between `run` and `--`.

## The full call graph

```
cli.Run(args)
  └─ ParseFlags(args[1:])        // strip program name, extract snip global flags
  └─ command = remaining[0]
  └─ cmdArgs = remaining[1:]
  └─ unproxyableReason(command)  // reject shell builtins (cd, source, etc.)
  └─ switch command {
       case "run":               // cli.go:177 — snip run -- <cmd>
         parseSeparatorArgs(cmdArgs, "run")
         runPipeline(targetCmd, targetArgs, flags)
       case "init", "gain", etc: // snip subcommands, NOT runPipeline
         ...
       default:                  // snip <cmd> — cli.go:212
         runPipeline(command, cmdArgs, flags)
     }
       └─ pipeline.Run(command, args)
            └─ Registry.Match(command, subcommand, filterArgs)
            └─ if matched: Execute(command, finalArgs) + ApplyPipeline
            └─ if !matched: Passthrough(command, args)
```
