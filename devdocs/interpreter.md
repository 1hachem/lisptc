# The interpreter core

`packages/interpreter/src/lisp.ts`, plus the two mechanisms an extension attaches
through (`hooks.ts`, `channels.ts`) and the tolerant reader built on them
(`prose.ts`). Derived from Nukata Lisp; what follows is only what a reader of the
code cannot work out from the code.

**The evaluator suspends rather than blocks.** `Interp.evalGen` is a generator
that yields a promise, so async work runs on Node's own event loop and needs no
second thread — see [promises.md](./promises.md).

## Reader

### There is no comment syntax

`;` is an ordinary symbol character. Only the parenthesised top-level forms are
program text; `stripProse` blanks everything else. Prose *is* the comment.

It **blanks rather than deletes**, so every form keeps its original offset and
the line numbers in reader and evaluation errors still point into the source the
caller passed in.

### `tokenPattern()` is a factory, not a shared RegExp

`exec()` advances a regex's own `lastIndex`, and callers loop it to exhaustion.
Sharing one instance across callers — the LSP tokenising alongside a running
interpreter — would corrupt each other's scan position.

The LSP tokenises with this same grammar rather than re-deriving its own, so the
two cannot drift apart.

### A string literal is bounded by the line it starts on

The tokeniser matches strings per line, so an unterminated one ends at the
newline and the reader reports it there. `endOfString` mirrors that deliberately.

### Reader sugar has to stand on its own

`startOfForm` extends a form back over `'`, `` ` ``, `,` and `,@` written
directly against it, so a quoted top-level form stays quoted. The sugar must
follow whitespace: prose punctuation that happens to touch a form
(`and then,(+ 1 2)`) is prose, not an unquote.

### `#<…>` is refused outright

Every value that cannot be read back prints that way — a promise, a secret, a
closure, a built-in — so a `#<…>` in source is *always* a retyped printout.
Left as an ordinary symbol it failed one step later as `void variable: #<promise`,
which named neither the mistake nor the fix. `readToken` raises an
`EvalException` (not a `FormatException`) because that is the error every layer
above already renders inline as a syntax error.

Four negative survey reports in two days were an agent typing a promise's printed form back.

### `readFailure` reports only parse failures

An `EvalException` the reader raises about a token it *did* read — the `#<…>`
above — is a complaint about real code, not a sign the text was never code. It is
left to be raised again where it matters.

## Hooks and channels

Two mechanisms the core owns, neither of which names an extension. Neither file
imports anything from an extension, and neither ever should.

**Hooks** (`hooks.ts`) are for *deciding*. Everything is one combinator: a
`Chain` is an ordered list of middlewares over a base behaviour, and the three
shapes the core needs fall out of it — a veto (`R` is `T | undefined`, base
answers `undefined`), a wrapping (`R` is the real result, base is the core's own
behaviour), a broadcast (`R` is void, base does nothing).

Registration order is **outermost-first**, matching the left-to-right reading of
`InterpOptions.extensions`. Folding from the end backwards is what puts
middleware 0 on the outside.

`evalForm` deliberately wraps one **top-level** form, not the recursive
`Interp.eval`, which runs per subexpression.

**Channels** (`channels.ts`) are for *reporting*. The core grew this by hand
three times before it was one abstraction: the module-level writer behind
`prin1`/`princ`, the prose skip notes threaded out as a callback, and errors
thrown for a host to catch and render.

Two axes, kept apart on purpose:

- the **channel is the audience**. A tool result worth 4KB to a model is noise in
  a terminal; a prose skip note is worth showing the user at once but is
  deliberately withheld from the model until its next turn.
- the **severity is the consequence**. Both a fatal error and a printed value go
  to the user; what separates them is whether the program survives.

Encoding either in the other is what forces a fourth bespoke callback. There is
deliberately no severity between `critical` and `warning`: one that aborted the
current top-level form and let the rest run would change what a program does.

`critical` is **thrown as well as emitted** — throwing is how the language
reports a fatal error and is what `try` catches. Emitting too is what lets a host
read errors off a channel instead of catching and re-rendering them into the same
string the output went to.

`emit` fans out synchronously and swallows a listener's throw: reporting must
never change the program's outcome.

A channel is not registered, only emitted on, so an extension adding one costs
the core nothing. `setWriter` remains the process-wide default sink for `user`,
so a host that never learns about channels still works.

## The evaluator is a generator

`Interp.evalGen` is a generator that yields a `Promise` when it needs to wait,
and `driveSync` / `runSync` pump it. That is what lets a single thread await
without blocking on its own event loop. Two drivers share one evaluator: a host
that cannot turn the loop uses `runSync`, which throws `cannot suspend` rather
than half-running a program.

### Only a call form can suspend

`evalNow` handles every non-`Cell` form (an `Arg`, a `Sym`, a literal, a
`Lambda`) synchronously, and every hot site checks `x instanceof Cell` before
delegating. Creating a generator to read a variable was most of the cost: with
the check, the argument loop allocates nothing for the common case.

For the same reason the **call protocol lives in `evalGen`**, not in the `Func`
classes. `Func.evalFrame`, `Closure.makeEnv` and `BuiltInFunc.evalWith` used to
own it, and each added a generator (and two JS stack frames) per Lisp call. A
builtin call now costs **zero** generator frames: `BuiltInFunc.call` is a plain
method, and only a builtin declared with `defGen` goes through `callGen`.

### Macro expansion is driven synchronously

`expandMacros` runs at *compile* time, inside `compile`, which is an ordinary
method reached from `evalGen`, `evalTry` and `compileInners`. It drives the macro
body with `driveSync`, so a macro that tries to await raises `cannot suspend`.
Expansion builds a form; it has no reason to wait on the world, and making the
whole compile path a generator would cost every call site for that.

### What generators cost, measured

`pnpm --filter @repo/interpreter bench` is the gate. Against the pre-generator
evaluator on one dev machine:

| case | before | after |
| --- | --- | --- |
| 300k tail-recursive calls | 361 ms | 467 ms |
| 300k `dotimes` iterations | 674 ms | 950 ms |
| non-tail `cons` recursion depth | 5624 | 3366 |
| non-tail arithmetic recursion depth | 3183 | 3366 |

A generator frame is bigger than a call frame, so **recursion depth is the real
cost**, not speed. Prelude `mapcar`, `_append` and `assoc` recurse once per
element, so the depth number is the longest list they can walk. It scales
linearly with `--stack-size`: 4000 buys about 5300 frames, 8000 about 10700, if
a host ever needs the old headroom back.

## Evaluator traps

### `Closure.toString` does not print its captured environment

The environment can hold the closure itself — a loop macro binds its body to a
local the body closes over — and `str`'s cycle guard does not survive the hop out
through `toString`. Rendering it recursed until the stack gave out. Any error
raised inside a multi-form `dotimes` body reached that path, since an
`EvalException`'s trace prints the forms it unwound through: the eval died with a
`RangeError` instead of reporting the error.

### `LoopSignal` is not an `EvalException`

`(break)` / `(return)` unwind to the nearest enclosing `while`/`dolist`/`dotimes`
through a signal that is deliberately *not* an `EvalException` subclass, so a
`try`/`catch` never intercepts it (`evalTry` only checks `instanceof
EvalException`) and a genuine `EvalException` is never swallowed by a loop's own
guard (which only checks `instanceof LoopSignal`).

A stray signal with no enclosing loop is converted to an ordinary
`EvalException` in `evalTopLevel`, which is why every top-level entry point goes
through it rather than calling `interp.eval` directly.

### `expandMacros` must not expand a `catch` clause's `(VAR)`

`(try BODY (catch (VAR) HANDLER...))` — `(VAR)` is a binding form, not code.
Expanding it means a catch-variable name colliding with an existing macro (`or`,
say) is misexpanded as a zero-arg call to that macro.

### `evalTry` trampolines the handler, not the body

Only `BODY-FORM`'s evaluation costs a non-tail JS stack frame, which is
unavoidable since we must synchronously observe whether it threw. The handler
body is handed back to the trampoline as `[x, env]` so tail calls in it stay
proper.

### `Unspecified` is compared by identity

`echo` returns it to mean "I already wrote my output", as opposed to `nil`, which
is a meaningful Lisp value (false / empty list). A REPL compares a top-level
result against it by identity to decide whether to report it, so a step that
printed gets no result line on top.

### `jsonToLisp` collapses `false` and `null`

Both become `nil`, since `nil` is Lisp's only falsity. A round trip through Lisp
cannot tell them apart.

### Circular imports are skipped, not an error

`Interp.importing` holds the absolute paths currently being imported; a file that
transitively imports itself is skipped rather than looping forever.
`Interp.importStack` resolves relative paths against the importing file's
directory (innermost wins), and is empty at the REPL, where paths resolve against
`process.cwd()`.

### `echoText` is exported so offsets agree

The compaction extension overrides `echo` to window and search the text, and a
word offset only means anything if both versions count the same string. The
newline `echo` ends on is added by the writer, not counted here — an offset that
included it would point one past the end of the value.

Strings render raw there (`quoteString` false) so a rendered document keeps its
newlines instead of becoming one `\n`-escaped line; strings nested inside a list
still print quoted, as `str` always does.

### Defaults are no-ops on purpose

`setWriter`'s sink and `setExit`'s process-exit both default to doing nothing, so
importing the interpreter (from a test, say) neither needs a running REPL nor
terminates the host. The CLI wires them.

## The prose classifier (`prose.ts`)

An opt-in extension holding **a guess about how a writer writes**, not a rule of
the language. It installs no built-in: it fills the three reader hooks.

Installing it is the whole of the choice. There is no per-call flag, because
tolerance is a property of whose text an interp is for, and that does not change
between one `run` and the next — a host needing both keeps two interps.
`checkSyntax` takes no interp at all, so editor diagnostics are strict by
construction.

The three hooks are answered in the order the reader reaches them, which is the
order of how much is known: `unclosedForm` and `unreadableForm` are put text that
never became a form, `skipForm` only a form that parsed.

**An unclosed `(` is prose unconditionally**, with no reasoning about the text at
all: a stray parenthesis in a sentence is far likelier from a model than a
truncated program, and reading it as one loses every form that came after it.
Scanning resumes just after that parenthesis, so a real form further along
(`"(roughly …\n(+ 1 2)"`) still runs.

**Balanced parentheses are not enough.** Markdown's backticks are quasiquote
sugar here, so ``(including a deprecated `read_file`)`` hands the reader a
quasiquote whose operand is the closing parenthesis and the sentence dies as
`unexpected ")"` — before any classifier could see it, since the classifier is
consulted once per *parsed* form.

**Where tolerance stops.** An unbound head only makes a form prose if the rest of
the form could be a sentence too. Two things say it could not:

- a mark of code — a keyword argument (`:url "…"`), a string literal, or an
  argument that is itself a call to something defined. Reader sugar does not
  count: `'t` and `,x` expand to `quote`/`unquote` heads, neither of them bound.
- a namespaced head (`server/tool`, `browser_close`) with no bare word after it.
  `(A/B test)` is English; `(server/tool)` is a call.

The case that forced this: a tool call whose server was never loaded,
`(server/tool :key "value")`. Reading that as a turn of phrase loses the step in
silence, and silence is the one failure an agent cannot debug.

What stays ambiguous is a misspelled word. `(lenght lst)` and `(step 2)` are the
same shape, so a typo with no literal in it is still read as prose and reported
as a skip naming the symbol — all the reader can honestly offer.

Boundness is the test, not callability, so calling a variable that holds a list
stays an ordinary "not applicable" error. It is checked per form as the program
runs, since an earlier form may be the `defun` that defines a later one's head.

### `isTruncated` is not `checkSyntax`

The one unreadable reply that is not a sentence: an LLM cut off by a token limit
leaves a parenthesis **open**. A host that ends its agent loop on whatever ran
nothing needs that difference — every other form that will not parse is prose to
this reader, and `checkSyntax` cannot tell the two apart. It asks nothing of an
interp, so a host can call it without having installed the extension.

## The prelude's higher-order list functions

`filter`, `reduce` and `get-in` were added because an agent without them wrote
manual recursion or a `dolist` accumulator for every selection, and a
`(cdr (assoc ...))` chain guarded by `or` for every field. Three decisions in
them are not free choices:

`reduce` takes its initial value **last** (`(reduce f list [initial])`), the CL
argument order, and checks that its second argument is a list. The other order
(`(reduce f initial list)`) is just as common in the wild, and a model that
guesses wrong would otherwise fold over the initial value and return something
plausible and wrong. The `listp` guard turns that into an error naming the
order, which costs one turn instead of a wrong answer nobody checks. `_reduce`
is tail-recursive, so it inherits the evaluator's TCO and does not grow the
stack on a long list; `filter`, like `mapcar` beside it, is not.

`get-in` guards **every** step, not just the last: a step whose value is not a
cons returns nil rather than raising, so a path through a field that came back
as a string or nil ends in nil like a missing key does. The point of the helper
is that no step needs a guard of its own.

`get-in` also falls back to matching a symbol or keyword key against the string
of its name (`_key-name`, which strips the `:` that `str` prints, since
`symbol-name` takes a `Sym` and a `LispKeyword` is not one). JSON and MCP
results carry string keys, and `(get-in x :port)` is the spelling a model
reaches for; the fallback runs only after an exact `assoc` misses, so an alist
that really is keyed by symbols still behaves.

## Argument plists (`plist.ts`)

Lives apart from `mcp.ts`, which grew it first, because `mcp.ts` carries the
`@modelcontextprotocol/sdk` dependency: a consumer that only wants keyword args
(`compaction.ts`) must not pull the MCP SDK in behind it.

`splitKeywordArgs` starts the options as soon as a keyword *could* be one — any
keyword carrying a value after it, **a misspelling included**, so
`(echo big :ofset 40)` reaches `plistOptions` and is rejected rather than
printing the literal `:ofset 40` after the whole value.

What cannot be an option is a keyword at the very end with no value to carry, and
that one is data: `(echo (promise-state p))` prints `:pending`. `allowed` is the
exception to the exception — a trailing `:offset` is an option whose value was
forgotten, and saying so is more use than printing the word.

`plistOptions` is stricter than `parsePlist`, which an MCP tool call needs to stay
lenient about since its keys come from a remote schema. For a built-in the keys
are fixed and a silently-ignored typo is worse than an error.

## Secrets (`secrets.ts`)

Full treatment in [secrets.md](./secrets.md). The one thing to keep in view here:
`Secret`'s `toJSON` is the **only** path that reveals a value, and `mcp.ts` never
imports this module — the two extensions communicate purely through the
`toString`/`toJSON` duck-typing convention (display form versus wire form), which
`str` and `lispToJson` respectively honour.

`(string x)` on a secret is the identity, because anything else would either
launder the taint away or hand back the redaction as a plain string.
