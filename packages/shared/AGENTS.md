# @repo/shared

The no-dependency utility layer, for what two packages both need and neither
owns. **It carries no dependencies at all**, workspace or otherwise, and
`pnpm check:arch` fails on anything in `dependencies` or `peerDependencies`.

Turbo tag: `foundation`.

## Shape

`src/host.ts` holds the ports two packages share and neither owns: the clock,
the prompt source, and the type that lets a value or a promise both satisfy a
port. `src/host-node.ts` holds the node-side implementations. That pair is the
only place the split lives for a shared port, and an extension's own ports stay
in its own `<name>-host.ts`.

`src/lisp-tokens.ts` and `src/lisp-forms.ts` hold the dialect's tokens and form
boundaries, so a highlighter, a language server and the prose classifier all
read the same definition. `src/lisp-form-fixtures.ts` holds the fixtures they
are tested against. `src/messages.ts` and `src/providers.ts` hold the role and
provider vocabularies.

## Rules

Something belongs here only when two packages need it and neither owns it. One
caller means it belongs with that caller.

Nothing here imports anything. If a utility needs a dependency, it is not a
shared utility, it is part of the package that has the dependency.

A port that only one package uses stays in that package. Moving it here is the
last step, not the first.
