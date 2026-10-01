# @lisptc/pi

The lisptc extension for the [pi](https://pi.dev) coding agent CLI. Pi brings
the TUI, the providers, the sessions and the keybindings; this brings the
language the model answers in.

Turbo tag: `product`.

## Shape

`src/extension.ts` is the default-exported pi extension factory. The `pi` key in
`package.json` is what points pi at it, so the directory is what a user names.
`src/cli.ts` is the `lisptc-pi` binary. It hands the factory to pi's `main` as
an inline extension rather than naming a path, so the entry point has a consumer
in the repo and `pnpm fallow` does not read it as a dead export.

Pi supplies itself to an extension, so `@earendil-works/*` belongs in
`peerDependencies` at `*`. Pi warns on a copy listed under `dependencies`,
because a second one in the process would be a second runtime.

`src/extensions.ts` holds the roster the REPL runs on, reaching the world
through the hosts a terminal should have.

`src/bridge.ts` is the part with behaviour worth pinning: what counts as a step,
what ends the loop, and how the transcript becomes the read-only globals.

## Rules

**The lisp is the model's own output, never a tool call.** `session_start`
empties pi's active tool set, so the model has no tool to reach for and the
assistant message is the program. `before_agent_start` forces
`systemPromptFor`, which is the prompt that says so.

`turn_end` is the loop. It evaluates the forms in the assistant message, appends
the result as a `custom_message` entry and returns `continue: true` for the next
request. A message with no form in it returns nothing, and pi settles: that is
how a turn ends, and there is no halt built-in.

This app names extensions because it is a composition root: it decides what the
agent can do. Adding one means adding it in `src/extensions.ts`.

**The two lanes stay apart.** A result entry's `content` is what the model
reads, and its `details` carry the human's copy. Do not collapse them into one
string.

## Tests

`test/bridge.test.ts` covers `src/bridge.ts`. Everything else here is pi event
wiring, and a case that needs a real model belongs in the evals.
