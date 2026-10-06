# @repo/ai

The agent loop and what it runs on. It depends on the REPL, and it is blind to
extensions by rule.

Turbo tag: `runtime`.

## Shape

`src/turn.ts` holds the loop, and the event union in that file is the whole
vocabulary of a turn. `src/stream.ts` puts a turn on the wire as server-sent
events. `src/eval.ts` is the one-shot evaluation.

`src/agent.ts` wraps the model call and yields deltas. `src/provider/` holds the
provider registry and one file per provider. `src/prompts/lisp.ts` holds the
system prompt and the step cap. `src/repl.ts` turns a transcript into model
messages and an eval result into content. `src/telemetry.ts` is the PostHog
side, and `src/turn-telemetry.ts` lays it over the turn's chains as their
outermost layer, so no hook can drop a trace and the loop names no capture.
`src/ui-action.ts` runs an action the browser sent back.

`src/repl-store.ts` keeps a REPL per thread. It builds none, so what a REPL
carries is decided by whoever constructed the store.

## Rules

**No file here names an extension**, the tests included. `check:arch` enforces
that over `src/` by directory, type imports included, and the roster of
exceptions is empty. The manifest carries none either: the `runtime` tag denies
`extension` in the root `turbo.json`, so `pnpm boundaries` fails on a dependency
as well as on an import. Do not open one.
If the loop needs something an extension knows, it arrives as an annotation or
through a slot, and the way to add it is in `packages/interpreter/AGENTS.md`.

**The turn is handed a REPL, it never builds one.** Every entry point here
takes one, or the store and the thread to draw one from. The extensions in it,
and the hosts under them, are assembled in `@repo/backend` and injected by the
product app.

Annotations are read by lane, never by key, and they are for the browser
alone. What the model reads is what an extension emits, and it reads the same
thing live and after a reload. The loop interprets no key, and a payload that
would need interpreting belongs below the seam instead.

A new kind of thing a turn can report is a new variant of the turn event union,
not a side channel.

A new point in the turn where an extension may act is a chain in
`SessionHooks`, run through a method on the REPL. The loop decides when it
runs and never what it does. Do not add a REPL method the loop calls for one
extension's sake.

## Tests

`test/annotation-lane.test.ts` is where the lane rule is pinned, and
`test/turn.test.ts` covers the loop. A test drives a real REPL rather than a
mocked one wherever it can, and that REPL is built from `test/helpers.ts`,
whose extensions are stubs written here. A REPL with nothing installed shows the
model only what a step failed with, so a case that needs the model-facing output
belongs in `@repo/backend`, where the real roster is composed.
