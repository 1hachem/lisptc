# @repo/lint-extension

The static check. What is wrong with source before it runs.

Turbo tag: `extension`.

## Shape

`src/lint.ts` is the extension: it hooks the `admit` chain and rejects a step
whose code would fail before it ran, and exports the same check for any root
that wants it without the chain. `src/check.ts` gathers the problems and writes
the rejection the model reads. `src/scope.ts` walks the forms the way the
evaluator would, carrying the names each binding form binds, and reports the
calls it reaches and the names nothing binds. `src/tokenize.ts`
turns text into positioned atoms, forms and calls. `src/calls.ts` checks each
call against the arity and the required keyword arguments its doc record
declares, and owns the diagnostic shape every check returns.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A diagnostic names no consumer. It carries a range, a message, a severity and a
code, and the editor and the agent each map it to what they speak at their own
root. **Do not import an editor protocol type here.**

The tokens come from `@repo/shared/lisp-tokens`. **Do not write a second
tokenizer.** A checker that disagrees with the reader reports errors that are
not real.

What a form expects comes from the interpreter's doc records, handed in through
a resolver, never from a table kept here. The checker never evaluates anything
to find out.

A rejection stops code from running, so the agent check stays conservative: a
false error costs a step, a missed one costs nothing the evaluator would not
report anyway. It reads source through the `readSource` chain, so it sees only
what evaluation will. It never flags a head nothing defines, which the session
reads as prose. It never reads quoted data, a parameter list or a macro's
arguments as calls, and it trusts a name the same code defines over the arity
the session holds.

Only an error stops a step; a warning is for a reader such as the MCP check. A
name nothing binds is an error where it would run now and a warning inside a
function body, which may run once it is bound. A name qualified by a server, the
way a loaded tool is named, is never flagged, because a server's tools are bound when it loads. A literal is
checked against the type its doc record declares only when that type names a
literal shape; an expression is never guessed at.

A binding form the walk does not know is treated like a macro: nothing inside
it is checked. Teaching it a new one is a case in `src/scope.ts` and a test.

## Tests

`test/`. A parser change needs a case in `test/tokenize.test.ts`.
