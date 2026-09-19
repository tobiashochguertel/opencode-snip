import { describe, it, expect, beforeEach } from "vitest"
import { toolExecuteBefore } from "./index"

describe("toolExecuteBefore", () => {
  let mockEvent: { tool: string; sessionID: string; id: string; input: { command: string } }

  beforeEach(() => {
    mockEvent = { tool: "bash", sessionID: "s", id: "c", input: { command: "" } }
  })

  it("should prefix simple command with snip", async () => {
    mockEvent.input.command = "go test ./..."
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("snip run -- go test ./...")
  })

  it("should handle command with one env var prefix", async () => {
    mockEvent.input.command = "CGO_ENABLED=0 go test ./..."
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("CGO_ENABLED=0 snip run -- go test ./...")
  })

  it("should handle command with multiple env var prefixes", async () => {
    mockEvent.input.command = "CGO_ENABLED=0 GOOS=linux go test ./..."
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("CGO_ENABLED=0 GOOS=linux snip run -- go test ./...")
  })

  it("should handle command with &&", async () => {
    mockEvent.input.command = "go test && go build"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("snip run -- go test && snip run -- go build")
  })

  it("should handle command with |", async () => {
    mockEvent.input.command = "git log | head"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("snip run -- git log | head")
  })

  it("should handle command with ;", async () => {
    // Commands with unquoted ; are passed through to avoid breaking compound constructs
    mockEvent.input.command = "go test; go build"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("go test; go build")
  })

  it("should handle command with ||", async () => {
    mockEvent.input.command = "test -f foo.txt || echo missing"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("snip run -- test -f foo.txt || snip run -- echo missing")
  })

  it("should handle command with &", async () => {
    // & is no longer split; the entire string becomes a single snip command
    // The shell handles the & for backgrounding at runtime
    mockEvent.input.command = "sleep 1 & sleep 2 &"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("snip run -- sleep 1 & sleep 2 &")
  })

  it("should handle mixed operators", async () => {
    // Contains unquoted ; so the entire command passes through
    mockEvent.input.command = "go test && go build; go run"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("go test && go build; go run")
  })

  it("should handle env vars with operators", async () => {
    mockEvent.input.command = "FOO=bar go test && go build"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("FOO=bar snip run -- go test && snip run -- go build")
  })

  it("should not double prefix already prefixed command", async () => {
    mockEvent.input.command = "snip go test"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("snip go test")
  })

  it("should not modify non-bash tool calls", async () => {
    mockEvent.tool = "read"
    mockEvent.input.command = "go test"
    await toolExecuteBefore(mockEvent)
    expect(mockEvent.input.command).toBe("go test")
  })

  describe("unproxyable shell builtins", () => {
    it("should skip cd", async () => {
      mockEvent.input.command = "cd /tmp"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("cd /tmp")
    })

    it("should skip source", async () => {
      mockEvent.input.command = "source ~/.bashrc"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("source ~/.bashrc")
    })

    it("should skip . (dot)", async () => {
      mockEvent.input.command = ". ./env.sh"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe(". ./env.sh")
    })

    it("should skip export", async () => {
      mockEvent.input.command = "export FOO=bar"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("export FOO=bar")
    })

    it("should skip alias", async () => {
      mockEvent.input.command = 'alias ll="ls -la"'
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe('alias ll="ls -la"')
    })

    it("should skip unset", async () => {
      mockEvent.input.command = "unset VAR"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("unset VAR")
    })

    it("should skip export with env var prefix", async () => {
      mockEvent.input.command = "CGO_ENABLED=0 export FOO=bar"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("CGO_ENABLED=0 export FOO=bar")
    })

    it("should skip cd but snip chained command", async () => {
      mockEvent.input.command = "cd /tmp && ls"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("cd /tmp && snip run -- ls")
    })
  })

  describe("redirections with &", () => {
    it("should not break 2>&1 redirection", async () => {
      mockEvent.input.command = "find / -name \"*.log\" 2>&1"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- find / -name \"*.log\" 2>&1")
    })

    it("should not break 1>&2 redirection", async () => {
      mockEvent.input.command = "cmd 1>&2"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- cmd 1>&2")
    })

    it("should handle 2>&1 with pipe", async () => {
      mockEvent.input.command = "find / -name \"*.log\" 2>&1 | grep error"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- find / -name \"*.log\" 2>&1 | grep error")
    })

    it("should handle 2>&1 with chained commands", async () => {
      mockEvent.input.command = "cmd1 2>&1 && cmd2"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- cmd1 2>&1 && snip run -- cmd2")
    })
  })

  describe("pipe expressions with quotes", () => {
    it("should not split pipes inside single quotes", async () => {
      mockEvent.input.command = "cat file.json | jq '.content | .text'"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- cat file.json | jq '.content | .text'")
    })

    it("should not split pipes inside double quotes", async () => {
      mockEvent.input.command = 'cat file.json | jq ".content | .text"'
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe('snip run -- cat file.json | jq ".content | .text"')
    })

    it("should handle jq with fromjson", async () => {
      mockEvent.input.command = "cat file.json | jq '.content[0].text | fromjson'"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- cat file.json | jq '.content[0].text | fromjson'")
    })

    it("should handle multiple pipes in jq", async () => {
      mockEvent.input.command = "cat file.json | jq '.a | .b | .c'"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- cat file.json | jq '.a | .b | .c'")
    })

    it("should handle pipe with || operator", async () => {
      mockEvent.input.command = "cmd1 || cmd2"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("snip run -- cmd1 || snip run -- cmd2")
    })

    it("should handle mixed quotes and pipes", async () => {
      mockEvent.input.command = 'echo "hello | world" | cat'
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe('snip run -- echo "hello | world" | cat')
    })
  })

  describe("shell loops with ;", () => {
    it("should pass through for loop unchanged", async () => {
      mockEvent.input.command = "for f in a b c; do echo $f; done"
      await toolExecuteBefore(mockEvent)
      // Contains unquoted ; — passes through to preserve the loop construct
      expect(mockEvent.input.command).toBe("for f in a b c; do echo $f; done")
    })

    it("should pass through while loop unchanged", async () => {
      mockEvent.input.command = "while true; do echo running; sleep 1; done"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("while true; do echo running; sleep 1; done")
    })

    it("should pass through for loop with pipes inside unchanged", async () => {
      mockEvent.input.command = "for f in *.log; do cat $f | grep error; done"
      await toolExecuteBefore(mockEvent)
      expect(mockEvent.input.command).toBe("for f in *.log; do cat $f | grep error; done")
    })
  })
})