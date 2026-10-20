# @repo/lint-extension

The static check. What is wrong with source before it runs.

Turbo tag: `extension`.

## Shape

One extension, which stops a step whose code would fail before it runs, and the
same check exported on its own for a root that wants it without the extension.
The check reads code the way the evaluator would and takes its call checks from
`@repo/language-service`, so the agent and the editor never disagree about a
call.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Import only `@repo/language-service/tokenize` and
`@repo/language-service/calls` from that package. **Do not import an editor
protocol type here**, and nothing else there loads one. A check that belongs to
both surfaces is written there; one only the agent needs stays here.

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

Inside a binding form it does not understand, the check stays silent.

## Tests

`test/`. The tokenizer and the call checks are tested in
`@repo/language-service`, and a parser change needs a case there.
