# Debug breakpoint context

Gemini CLI includes debugger-aware context for breakpoint targets, project debug
config discovery, and IDE-fed debug state for breakpoints and paused
executions.

<!-- prettier-ignore -->
> [!NOTE]
> Gemini CLI can inspect debug-related state, but it does not yet launch,
> attach, pause, continue, or step through debug sessions on its own.

## Breakpoint target syntax

Gemini CLI recognizes breakpoint targets in the form `@file:line` or
`@file:line:column`.

```text
@src/foo.ts:87
src/foo.ts:87
@src/foo.ts:87:4
```

This syntax mirrors Gemini CLI's existing `@path` pattern, but these values are
interpreted as debugger breakpoint targets rather than direct file inclusion.

## Debug config discovery

Gemini CLI searches upward from the current working directory for one of the
following files:

```text
.gemini/debug.json
.gemini/debug.config.json
```

The current config schema supports launch-style and attach-style configuration
entries with fields including:

- `name`
- `type`
- `request`
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

Use the `/debug` command group to inspect parsed breakpoint targets, view the
active project debug config, and review IDE-fed debug state.

```text
/debug break @src/foo.ts:87
/debug config show
/debug config validate
/debug status
```

### Current command behavior

At present:

- `/debug break` parses and normalizes a breakpoint target and provides that
  target as debug-aware context.
- `/debug config show` prints the discovered debug config file and its contents.
- `/debug config validate` validates the discovered debug config.
- `/debug status` displays IDE-fed breakpoint and paused-state information, when
  available.

## IDE-fed debug state

When the IDE companion is connected, Gemini CLI can receive:

- source breakpoints
- the latest paused debug stop snapshot

The paused snapshot is intentionally bounded and includes the stop reason,
location if known, top stack frames, top locals, and a timestamp.

## Current limitations

Gemini CLI does not yet provide a standalone cross-runtime CLI debugger engine.
The following debugger workflows are not yet implemented as first-class CLI
operations:

- launch
- attach
- continue
- pause
- step over
- step into
- step out
- stop

The current implementation focuses on shared parsing and modeling, shared debug
config support, IDE-to-CLI debug context plumbing, and a CLI inspection
surface.

## Next steps

- Learn more about [IDE integration](../ide-integration.md).
- See the [command reference](../reference/commands.md) for the broader CLI
  command surface.
