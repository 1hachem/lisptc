# @lisptc/pi

The lisptc extension for the [pi](https://pi.dev) coding agent CLI. Pi brings
the TUI, the providers, the sessions and the keybindings; this brings the
language the model answers in.

Turbo tag: `product`.

## Shape

`src/extension.ts` is the extension pi loads, and the `pi` key in `package.json`
is what points at it. `src/cli.ts` is the `lisptc-pi` binary.

`src/extensions.ts` holds the roster the REPL runs on. `src/bridge.ts` holds the
decisions a turn rests on, and `src/render.ts` the transcript surface.

## Rules

**The lisp is the model's own output, never a tool call.** The model is left no
tool to reach for, and the prompt that says so is the interpreter's own. Do not
write a second description of the dialect here.

**The loop is pi's.** This app hooks pi's boundaries and opens none of its own.
A turn ends because the model wrote no form, so there is no halt to add.

**The binary consumes the extension rather than naming its path**, because an
entry point with no consumer in the repo fails `pnpm fallow` as a dead export.

**Pi supplies itself.** `@earendil-works/*` belongs in `peerDependencies` at
`*`. A copy under `dependencies` is a second runtime in the process, and pi
warns on it.

This app names extensions because it is a composition root: it decides what the
agent can do. Adding one means adding it in `src/extensions.ts`.

**The two lanes stay apart.** What the model reads and what the human reads are
separate fields of a result. Do not collapse them into one.

## Tests

`test/bridge.test.ts` and `test/render.test.ts` cover what this app decides.
Everything else here is pi event wiring, and a case that needs a real model
belongs in the evals.
