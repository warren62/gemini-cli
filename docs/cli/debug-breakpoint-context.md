# Debug breakpoint context (MVP)

Gemini CLI now supports an MVP debugger-aware context flow for breakpoint targets,
launch-style debug configuration, and IDE-fed paused-state snapshots.

## Breakpoint target syntax

Use `@file:line` or `@file:line:column` to represent a breakpoint target.
Examples:

```text
@src/foo.ts:87
src/foo.ts:87
@src/foo.ts:87:4
```

This syntax intentionally mirrors Gemini CLI's existing `@path` mental model,
but these values are parsed as debugger breakpoint targets instead of direct
file inclusion references.

## Debug config discovery

Gemini CLI searches upward from the current working directory for one of these
files:

```text
.gemini/debug.json
.gemini/debug.config.json
```

The config format is launch-style and currently supports these fields per
configuration:

- `name`
- `type`
- `request` (`launch` or `attach`)
- `cwd`
- `program`
- `args`
- `env`
- `host`
- `port`
- `stopOnEntry`
- `breakpoints`
- `adapterOptions`

## `/debug` commands

Use the built-in `/debug` command group to inspect parsed breakpoint targets,
project config, and IDE-fed runtime debug state.

```text
/debug break @src/foo.ts:87
/debug config show
/debug config validate
/debug status
```

## IDE-fed debug state

In this MVP, Gemini CLI does not start or control standalone debug sessions on
its own. Instead, the VS Code companion publishes:

- source breakpoints
- the latest paused debug stop snapshot

That paused snapshot is intentionally bounded and includes the stop reason,
location if known, top stack frames, top locals, and a timestamp.

## Current limitation

This MVP does **not** implement a standalone cross-runtime CLI debugger engine or
full debug orchestration commands such as start, attach, continue, or step.
The focus is shared parsing/modeling, shared config, IDE-to-CLI debug context
plumbing, and a first-class CLI inspection surface.
