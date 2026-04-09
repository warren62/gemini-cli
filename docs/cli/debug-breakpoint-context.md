# Gemini CLI debugger

Gemini CLI now has a Phase 2 debugger MVP.

Phase 1 only made Gemini CLI debugger-aware for prompt context and IDE-fed
status. Phase 2 adds a real CLI-owned debugger model with stored breakpoints,
session lifecycle state, and a real Node.js runtime path.

## What Phase 2 adds

- CLI-owned breakpoint storage
- a CLI-owned debug session store
- real session start and attach flows from `.gemini/debug.json`
- paused runtime snapshots captured from the active session
- `/debug status` driven by CLI-owned state first

The VS Code companion still publishes IDE breakpoints and paused-state context,
but that is now secondary mirror context instead of the authoritative debugger
model.

## Supported runtime

Phase 2 currently supports a narrow real-runtime path for Node.js
configurations:

- `type: "node"`
- `type: "pwa-node"` as a compatibility alias

Other debug adapter/runtime types are not yet implemented in this phase.

## Breakpoint target syntax

Use `@file:line` or `@file:line:column`.

Examples:

```text
@src/index.ts:10
src/index.ts:10
@src/index.ts:10:4
```

These values now represent real CLI-owned debugger breakpoints. If a session is
already active, Gemini CLI pushes them into the active debug adapter. If no
session is active yet, Gemini CLI stores them and applies them when a session
starts.

## Debug config discovery

Gemini CLI searches upward from the current working directory for one of these
files:

```text
.gemini/debug.json
.gemini/debug.config.json
```

## Config shape

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

`runtimeExecutable` and `runtimeArgs` are useful for Node launches that should
run through something other than the default Node executable.

Example:

```json
{
  "configurations": [
    {
      "name": "app",
      "type": "node",
      "request": "launch",
      "cwd": ".",
      "program": "dist/index.js",
      "stopOnEntry": false,
      "breakpoints": [
        {
          "raw": "@src/index.ts:10",
          "filePath": "src/index.ts",
          "line": 10,
          "normalized": "@src/index.ts:10"
        }
      ]
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

## `/debug` commands

Phase 2 turns `/debug` into a real operational debugger surface:

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

## `/debug status`

`/debug status` now reports CLI-owned debugger state first, including:

- session lifecycle state
- active config and request type
- stored breakpoint count
- latest paused snapshot
- top locals when paused

If the IDE companion is connected, Gemini CLI may also show IDE mirror context
for comparison, but that mirror state is not the source of truth for CLI-owned
debug sessions.

## Current limitations

This is still an MVP. Phase 2 does not yet include:

- full multi-language debug adapter support
- stepping UX
- watch expressions
- multi-session orchestration
- automatic IDE breakpoint resync heuristics

Phase 2 is specifically the milestone where Gemini CLI moves from "debug-context
aware" to "able to own a minimal real debug session."
