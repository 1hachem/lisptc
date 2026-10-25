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

`src/thread.ts` is the actor a conversation runs in, and `src/mailbox.ts` is
what reaches it. `src/threads.ts` supervises them: it opens a thread through
its host, evicts an idle one, and keeps each thread's lineage, its jobs and its
REPL. `src/budget.ts` is what a thread may still spend, billed to every
ancestor.

`src/threads.ts` builds no REPL, so what one carries is decided by the host it
was handed. `src/repl-store.ts` is the shape a caller reads a REPL through.

## Rules

**No file here names an extension**, the tests included. `check:arch` enforces
that over `src/` by directory, type imports included, and the roster of
exceptions is empty. The manifest carries none either: the `runtime` tag denies
`extension` in the root `turbo.json`, so `pnpm boundaries` fails on a dependency
as well as on an import. Do not open one.
If the loop needs something an extension knows, it arrives as an annotation or
through a slot, and the way to add it is in `packages/interpreter/AGENTS.md`.

**A turn starts from a post, never from a request.** Everything that reaches
a conversation, a message, a steer, a follow-up or a notice, is posted to its
thread. The thread runs one turn at a time, and what arrives while one runs
reaches it at the next step. Only the thread calls the loop, and `check:arch`
fails on any other caller here or in the app's server. An event posted from
outside the user never runs as Lisp. What the thread writes or reads outside
the process goes through a port it declares, and the carrier satisfies it.

**A thread never runs past what its parent has left.** A child's budget is
sliced from its parent's, a spawn past the depth cap is refused, and a cancel
reaches every descendant. A running thread, and one that holds a paused step,
is never evicted.

**The turn is handed a REPL, it never builds one.** Every entry point here
takes one, or the store and the thread to draw one from. The extensions in it,
and the hosts under them, are assembled in `@repo/backend` and injected by the
product app.

The loop interprets no annotation, coming or going. The browser reads one by
lane, never by key. What the model reads is what an extension emits, the same
live and after a reload. A payload that would need interpreting belongs below
the seam.

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
