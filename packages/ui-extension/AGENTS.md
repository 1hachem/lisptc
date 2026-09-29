# @repo/ui-extension

The UI surface. The widgets a model builds a view out of, and the way a click on
one gets back into the REPL.

Turbo tag: `extension`.

## Shape

`src/ui.ts` is the extension: it declares `UiHost`, holds `UiSurface`, registers
the widget constructors, and hooks the `invoke`, `annotate` and `message`
chains. `src/ui-host.ts` holds the host a root passes in. `src/ui.ptc` is the
prompt.

`UiHost` declares one port, the prompt. The rendered view crosses the seam as an
annotation, so nothing above has to know this extension drew it.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

This package renders nothing and imports no component. It builds a tree and
hands it over; what draws it lives in the frontend, which reads the annotation
and never names this package.

An interaction comes back as an invocation in the REPL that produced the view. A
new widget is a constructor beside the others, and a new thing a widget can do
is a field on the tree, never a callback held somewhere outside it.

## Tests

`test/ui.test.ts` covers the tree the constructors build, that nothing is
reported until a render, and how a child that is a bare string is lifted. A test
installs this extension and no other.
