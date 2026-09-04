# Context compression

The REPL is an LLM's only interface, so everything it prints is spent context.
Nothing bounded that: `MemoryRepl.eval` appended `str(value)` verbatim and
`packages/ai` JSON-wrapped the whole string into the model's next turn, so one
`(playwright/snapshot)` could swallow the window in a single step.

Then a second problem surfaced, the opposite of the first: the model was
*shown* data and copied it back by hand — re-typing a URL it had just seen,
hand-writing a list of issues it already held in a variable. A printout is
something to retype; a name is not.

So the REPL prints **nothing** on its own. Three mechanisms:

- **Every top-level result is bound to a name** — `<function>-<n>` — and
  reported as one line, `name: shape`. The next step refers to
  `acme/list-issues-1` instead of retyping the data, which is both cheaper and
  the only way to be sure the value is exact.
- **A result is described, not shown**: `list of 27 alists, keys "id" "title" …`
  tells the model what it needs to write the next form and gives it nothing to
  mis-copy. Small values (≤ `INLINE_WORDS`) are reported as themselves, because
  below that a shape costs more to read than the value it hides.
- **`echo` is the only thing that writes**, and what the *model* sees of it is
  capped per step. `grep` does not print at all: it returns a value, which is
  therefore named like any other result. That is the pattern the whole design is
  for — extract into a name, then echo a rendering of it.
- **A slice is the exception**, because it is asked for in order to be read: a
  top-level `head`/`tail` form has its slice *printed* in place of a report,
  and mints no name. Describing one back (`head-1: list of 5 items`) told the
  model only what it already knew and cost it a second step on the `(echo
  head-1)` it had meant all along. `result` decides this from the form, not the
  built-in (see `isSliceForm`), so a slice nested in another form — `(mapcar f
  (head x 5))`, `(setq top (head x 5))` — prints nothing and is just a value.

Describing instead of showing is only safe *because* of the naming: nothing is
lost by not printing it.

Everything lives in `packages/interpreter/src/compression.ts`, an **opt-in
extension** like secrets and MCP.

## The pieces

- `Compressor` — the naming counters for one interpreter, the current step's
  echo budget, plus every render entry point: `result` (a top-level result's
  report line), `window` / `search` (what `echo` writes), `error` (a rendered
  `EvalException`).
- `beginStep` / `takeEcho` — the step boundary. A host calls `beginStep` before
  an eval and `takeEcho` after it for the model's copy of the output.
- `describe` — value → shape line. Callables report their kind (`function`,
  `macro`) rather than a closure's internals; a list of alists reports its keys;
  a blob with no whitespace is measured in characters, since its word count is 1
  however big it is.
- `splitKeywordArgs(args, ECHO_OPTIONS)` — values from trailing options. A
  keyword only reads as an option when it carries a value after it (so a
  misspelled `:ofset 40` is an error, not two printed words) or when it is one
  of `ECHO_OPTIONS` left without its value; a trailing keyword is otherwise
  data, which is what makes `(echo (job-status job))` print `:pending`.
- `print` — writes a value the way `echo` does (human's copy out through the
  writer, model's copy charged to the step's budget). What `result` calls for a
  top-level slice.
- `compressionExtension(compressor?)` — installs `head` / `tail` / `grep`, and
  **overrides** the core `echo` with the windowed, searchable version (the same
  `interp.def` idiom `secretsExtension` uses on the string primitives, so an
  interpreter without this extension still has a plain `echo`).

`Compressor` holds **no values**. A named result is an ordinary global, which is
what lets `echo`/`grep` take a *value* rather than a handle — so they work just
as well on a `let` binding or anything the agent named itself, and `dump`/`doc`
keep working with no special cases.

## Two copies of every output

A human reads output once, on screen; the model carries it for the rest of the
loop. So each `echo` produces both, as `Bounded`:

- `user` — what was asked for, uncapped. Written straight to the interpreter's
  writer.
- `model` — as much of it as the step's word budget still allows, closing with a
  `...` line naming the value and the offset to resume from.

The capping happens inside `window`/`search` because that is the only place that
still knows *which value* the text came from, and so the only place that can
point the agent back at it by name. Capping the buffer again downstream would
restart the offsets from zero and send the agent to the wrong place — which is
exactly the bug the earlier per-eval re-window had.

The budget is **per step, not per call**: an echo loop floods the context just as
effectively as one huge echo. When a call contributes nothing at all to the
model's copy, `takeEcho` closes with a note saying how many words it did not
see. A call that was merely *shortened* needs no such note — its own `...` line
already says how much is below.

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

`MemoryRepl` is the choke point. `evalOutput` returns both copies; `eval`
returns `model`, so `apps/mcp` and `session-server.ts` need no code of their own.
`packages/ai` uses `evalOutput`: the capped copy goes in the tool message's
`content` (which the client replays as the next request's input, so uncapped text
there would re-enter the model's context on every later turn), and the uncapped
copy rides in `additional_kwargs.display`, which only the UI reads.

`cli.ts` calls `beginStep` per form and writes only the report line. It points
the interpreter's writer straight at stdout, so a human at a terminal sees the
uncapped copy and can scroll.

## Why words, and the character backstop

The limit is counted in whitespace-separated words, and so is every number the
markers report. A word cap alone bounds nothing, though: minified JSON is a
single megabyte-long "word". `MAX_CHARS_PER_WORD` (12 × the word limit) is a
hard character backstop that cuts such a blob mid-word.

A cut word cannot be paged past by word offset, so its marker points at the
prelude's `substring` instead of an `:offset`:

```
... 24 of 40 characters shown (one unbroken word) — read on with
(echo (substring blob 24 40))
```

## Why `echo :match` reports word offsets, not line numbers

`str` of a large list is a **single line** with no newlines in it at all, so a
line-oriented search would report one enormous match. Each hit is reported as
`@<word-offset>` plus a `:context`-word window, which behaves the same on a
one-line Lisp render and on multi-line text — and the offset feeds straight back
into `(echo x :offset N)`. Hits falling inside a window already printed are
counted rather than repeated.

`:match` is for *reading* a value you cannot yet name a pattern for. `grep` is
for *keeping* what matched, and the summary line says so.

## Naming rules

In order, `Compressor.result` and `nameFor`:

1. `Unspecified` — what `echo` returns — reports nothing at all. The step has
   already said what it had to say; a line on top would only announce that
   printing happened.
2. A top-level `head`/`tail` form reports nothing either — its slice is
   printed instead (see `isSliceForm`), and no name is minted for it: the
   value it was sliced out of already has one.
3. A **job** is reported by name plus what the name is for — `load-mcp-1:
   load-mcp:linear running in the background … (await load-mcp-1) …` — and its
   handle (`#<job …>`) is never shown, in this line or in `describe`. The
   handle is not readable source, and an agent shown one types it back:
   `(await #<job load-mcp:linear 8d12…>)` was four negative survey reports in
   two days. The line also says that nothing is owed, since a job applies its
   own result when it settles. Recognised by shape (`jobLabel`), because
   compression may not import the jobs layer.
4. `nil` and `t` are reported plainly. They carry nothing a later step could
   refer to, and every side-effecting loop returns `nil`; naming those would
   bury the results that matter under `dotimes-1: nil`.
5. A value that is a symbol already bound as a global — what `defun`/`defmacro`
   return — is reported under that name, describing what it now holds
   (`f: function`).
6. A `setq` reports the symbol **it** assigned, read off the form (the last one,
   for `(setq a 1 b 2)`). Reverse lookup alone would only find it for a `Cell`
   or a string, not for a number.
7. A value an existing global already holds reuses that name — so a result the
   agent bound itself is not given a second one.
8. Otherwise the head symbol of the form plus a per-name counter, skipping any
   name already taken so an agent's own `foo-1` is never clobbered. A form with
   no symbol at its head (`((lambda …) 1)`) becomes `result-N`.

Every bound name carries a `Doc`, so `(doc range-1)` explains itself — and
`test/docs.test.ts`, which asserts no global is undocumented, stays honest.

## One canonical text per value

A word offset only means something if every command counting words measures the
same string, so they all go through `canonical`: raw for a string, `str`
otherwise. That is also what `echoText` (in `src/lisp.ts`) renders, so an offset
`echo` reports can be fed straight back to it. Strings bypass `str` because it
escapes newlines as a literal `\n`, which turns a long document into one
unreadable line whose offsets would not match what was shown.

`echoText` deliberately does **not** include the trailing newline `echo` ends
on: it is measured in words and characters, and an offset that counted the
newline would point one character past the end of the value — enough to make the
`substring` hint in a hard-cut marker fail.

## Known limitations

- `str(value)` is still materialised in full before slicing (as it always was),
  so a pathological shared structure can blow up before the cap applies.
- A truncated echo of a list prints without its closing paren. The marker says
  so, but the fragment is not readable Lisp.
- Inner strings inside a list are still `\n`-escaped by `str`; only a top-level
  string renders raw. An unescaping printer is a separate change.
- `describe` reads the keys off the first element of a list of alists and only
  checks the rest for agreement (`(keys vary)`); it does not report the union.

## Teaching the model

Half the feature is the prompt: a model that is not told waits for values it
will never be shown, and keeps retyping data it could have named. `SKILL.md` §5
lists the built-ins — `echo` under Output, `head`/`tail`/`grep` under Extracting
(where a bare slice's printing is spelled out) — and §9 explains the silence,
the report line, and the extract-then-echo
pattern with a worked example of each failure. POLICY rules 2, 10, 11 and 11a in
`packages/ai/src/prompts/lisp.ts` say it outright, and rule 4c corrects the one
thing the model cannot observe: the user *does* read what a step echoes.
`test/prose-surfaces.test.ts` and `packages/ai/test/prompt.test.ts` pin both
surfaces so they cannot silently regress.
