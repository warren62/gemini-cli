# Debugger

Gemini CLI can manage debugger breakpoints, start or attach a debug session, and
report paused runtime state from the command line.

The CLI owns the active debug session state. If the VS Code companion is
connected, Gemini CLI can also show IDE breakpoint and paused-state information
as additional context, but the CLI session is the source of truth for `/debug`
commands.

## Supported runtimes

Real debugger control is currently available for Node.js configurations:

- `type: "node"`
- `type: "pwa-node"`

## Breakpoint target syntax

Use `@file:line` or `@file:line:column`.

Examples:

```text
@src/index.ts:10
src/index.ts:10
@src/index.ts:10:4
```

Breakpoints created with `/debug break` are stored by Gemini CLI. If a session
is already running, Gemini CLI applies them to the active debug adapter. If no
session is active yet, Gemini CLI stores them and applies them when a session
starts.

## Debug config discovery

Gemini CLI searches upward from the current working directory for one of these
files:

```text
.gemini/debug.json
.gemini/debug.config.json
```

## Configuration format

Debug configuration files use a top-level `configurations` array.

```json
{
  "configurations": [
    {
      "name": "app",
      "type": "node",
      "request": "launch",
      "cwd": ".",
      "program": "dist/index.js",
      "stopOnEntry": false
    },
    {
      "name": "attach-local",
      "type": "node",
      "request": "attach",
      "host": "127.0.0.1",
      "port": 9229
    }
  ]
}
```

Each configuration supports these fields:

- `name`
- `type`
- `request`
- `cwd`
- `program`
- `runtimeExecutable`
- `runtimeArgs`
- `args`
- `env`
- `host`
- `port`
- `stopOnEntry`
- `breakpoints`
- `adapterOptions`

`runtimeExecutable` and `runtimeArgs` are useful when launching through a custom
Node entrypoint or wrapper, such as `tsx`.

## Commands

Use `/debug` to manage breakpoints, session control, and status:

```text
/debug break @src/index.ts:10
/debug break list
/debug break remove bp-1
/debug config show
/debug config validate
/debug start app
/debug attach attach-local
/debug continue
/debug pause
/debug stop
/debug status
```

## Status output

`/debug status` reports CLI-owned debugger state, including:

- session lifecycle state
- active configuration and request type
- stored breakpoint count
- latest paused snapshot
- top stack frame and locals when paused

If the VS Code companion is connected, Gemini CLI may also show IDE mirror
context for comparison.

## Current limitations

The debugger currently focuses on a narrow but real runtime path for Node.js. It
does not yet include:

- multi-language debug adapter support
- stepping commands
- watch expressions
- multi-session orchestration
- automatic IDE breakpoint synchronization heuristics
