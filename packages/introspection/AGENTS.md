# @repo/introspection-extension

Introspection. The surface for reading what is defined: arity, kind,
signature, keyword arguments, source, and a search over the docs.

Turbo tag: `extension`.

## Shape

`src/introspection.ts` is the extension, `src/introspection-host.ts` the host a
root passes in, `src/introspection.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Every form here only reads the interpreter. The doc table, the `doc` form and
the recording of a definition's source stay in the interpreter, because every
`def` writes the table and the prelude's `defun` and `defmacro` record the
source. A form that needs something the interpreter does not expose asks for a
reader on `Interp`, never a copy kept here.

A form that prints answers the model as well as the user, the way `doc` does.

## Tests

`test/`. A test installs this extension and no other.
