# @repo/ai

The agent loop and what it runs on. It depends on the REPL, and it is blind to
extensions by rule.

Turbo tag: `agent`.

## Shape

`src/turn.ts` holds the loop. One turn reads the transcript, asks the model for
code, evaluates it in the REPL, and yields an event per thing that happened
until the REPL says the turn finished or the step cap stops it. The event union
in that file is the whole vocabulary of a turn. `src/stream.ts` puts that on the
wire as server-sent events. `src/eval.ts` is the one-shot evaluation.

`src/agent.ts` wraps the model call and yields deltas. `src/provider/` holds the
provider registry and one file per provider. `src/prompts/lisp.ts` holds the
system prompt and the step cap. `src/repl.ts` turns a transcript into model
messages and an eval result into content. `src/telemetry.ts` is the PostHog
side. `src/ui-action.ts` runs an action the browser sent back.

`src/repl-store.ts` keeps a REPL per thread and builds the extension list.

## Rules

**No file here names an extension, except `src/repl-store.ts`.** `check:arch`
enforces that by directory, type imports included, with `repl-store.ts` as the
single listed exception. Do not add a second one. If the loop needs something an
extension knows, it arrives as an annotation or through a slot, and the way to
add it is in `packages/interpreter/AGENTS.md`.

Annotations are read by lane, never by key. One lane rides the tool result the
model reads, the other rides the wire the browser reads. The loop merges them
and puts them where they go. It does not interpret a key, and a payload that
would need interpreting belongs below the seam instead.

A new kind of thing a turn can report is a new variant of the turn event union,
not a side channel.

## Tests

`test/annotation-lane.test.ts` is where the lane rule is pinned, and
`test/turn.test.ts` covers the loop. A test drives a real REPL rather than a
mocked one wherever it can.
