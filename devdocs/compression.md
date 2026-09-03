# Context compression

The REPL is an LLM's only interface, so everything it prints is spent context.
Nothing bounded that: `MemoryRepl.eval` appended `str(value)` verbatim and
`packages/ai` JSON-wrapped the whole string into the model's next turn, so one
`(playwright/snapshot)` could swallow the window in a single step.

Two mechanisms, and they only work together:

- **Every top-level result is bound to a name** — `<function>-<n>` — and echoed
  as `name = value`. The next step refers to `linear/list-issues-1` instead of
  retyping the data, which is both cheaper and the only way to be sure the value
  is exact. Retyping is where hallucinated ids and titles come from.
- **What gets printed is capped** at a word limit, closing with a `...` line
  saying how much was shown, how much is left, and which name holds the rest.

Truncating is only safe *because* of the naming: nothing is lost by not printing
it. And naming is worth doing even when nothing is truncated, because the point
is to stop the model re-emitting data it already has.

Everything lives in `packages/interpreter/src/compression.ts`, an **opt-in
extension** like secrets and MCP.

## The pieces

- `Compressor` — the naming counters for one interpreter, plus every render
  entry point: `value` (a top-level echo), `output` (the `princ`/`print`
  buffer), `error` (a rendered `EvalException`), `window` / `windowTail` /
  `search` (the built-ins).
- `compressionExtension(compressor?)` — installs `view` / `head` / `tail` /
  `grep` over that compressor.
- `RawText` — text that prints as itself. `str`'s fallback branch renders an
  unknown object via `${x}`, so a `toString` is all it takes; the same trick
  `Unspecified` uses, and no change to the printer.

`Compressor` holds **no values**. A named result is an ordinary global, which is
what lets `view`/`grep` take a *value* rather than a handle — so they work just
as well on a `let` binding or anything the agent named itself, and `dump`/`doc`
keep working with no special cases.

## Consuming from a host

Unlike `secretsExtension`, whose store is host configuration that must survive a
`reset()`, the host creates a **new `Compressor` per interpreter**: the counters
have to die with the globals they named, or a reset leaves the count climbing
past names that are no longer bound.

```ts
private freshInterp(): Interp {
  this.compressor = new Compressor(this.wordLimit);
  return new Interp({ extensions: [..., compressionExtension(this.compressor)] });
}
```

`MemoryRepl` is the choke point: it takes `{ wordLimit }`, names each top-level
result through `run`'s `onTopLevel` callback, and caps the side-effect buffer
once at the end. `apps/mcp` and `packages/ai` need no code of their own — they
pass through `MemoryRepl.eval` and inherit the cap. An MCP client of `apps/mcp`
therefore now gets truncated results too; that is intended.

`cli.ts` caps only the value echo. It points the interpreter's writer straight
at stdout, so `princ` output streams uncapped — buffering it to measure would
break that, and a human at a terminal can scroll.

## Why words, and the character backstop

The limit is counted in whitespace-separated words, and so is every number the
markers report. A word cap alone bounds nothing, though: minified JSON is a
single megabyte-long "word". `MAX_CHARS_PER_WORD` (12 × the word limit) is a
hard character backstop that cuts such a blob mid-word.

A cut word cannot be paged past by word offset, so its marker points at the
prelude's `substring` instead of `view`:

```
... 4800 of 3145728 characters shown (one unbroken word). Full value saved in
concat-1 — read on with (substring concat-1 4800 9600)
```

## Why `grep` reports word offsets, not line numbers

`str` of a large list is a **single line** with no newlines in it at all, so a
line-oriented grep would report one enormous match. Each hit is reported as
`@<word-offset>` plus a `:context`-word window, which behaves the same on a
one-line Lisp render and on multi-line text — and the offset feeds straight back
into `(view x :offset N)`. Hits falling inside a window already printed are
counted rather than repeated.

## Naming rules

In order, `Compressor.nameFor`:

1. A value that is a symbol already bound as a global — what `defun`/`defmacro`
   return — is echoed alone (`f`, not `f = f`).
2. `nil` and `t` are echoed plainly. They carry nothing a later step could refer
   to, and every side-effecting loop returns `nil`; naming those would bury the
   results that matter under `dotimes-1 = nil`.
3. A `setq` reports the symbol **it** assigned, read off the form (the last one,
   for `(setq a 1 b 2)`). Reverse lookup alone would only find it for a `Cell`
   or a string, not for a number.
4. A value an existing global already holds reuses that name — so a result the
   agent bound itself is not given a second one.
5. Otherwise the head symbol of the form plus a per-name counter, skipping any
   name already taken so an agent's own `foo-1` is never clobbered. A form with
   no symbol at its head (`((lambda …) 1)`) becomes `result-N`.

Every bound name carries a `Doc`, so `(doc range-1)` explains itself — and
`test/docs.test.ts`, which asserts no global is undocumented, stays honest.

## One canonical text per value

A word offset only means something if truncation and `view` measure the same
string, so both go through `canonical`: raw for a string, `str` otherwise.
Strings bypass `str` because it escapes newlines as a literal `\n`, which turns
a long document into one unreadable line whose offsets would not match what
`view` shows.

The visible consequence is deliberate: a value **under** the cap prints through
`str` exactly as before (a short string stays quoted and re-readable), while a
truncated string falls back to its raw text — which is what `view` will show
anyway, and the marker makes the difference unambiguous.

## Known limitations

- `str(value)` is still materialised in full before slicing (as it always was),
  so a pathological shared structure can blow up before the cap applies.
- A truncated list prints without its closing paren. The marker says so, but the
  fragment is not readable Lisp.
- Inner strings inside a truncated list are still `\n`-escaped by `str`; only a
  top-level string renders raw. An unescaping printer is a separate change.

## Teaching the model

Half the feature is the prompt: a model that is not told reads a `...` line as
the end of the value and keeps retyping data. `SKILL.md` §5 lists the built-ins
and §9 explains the naming and the cap; POLICY rules 10 and 11 in
`packages/ai/src/prompts/lisp.ts` say it outright. `test/prose-surfaces.test.ts`
and `packages/ai/test/prompt.test.ts` pin both so the surface cannot silently
regress.
