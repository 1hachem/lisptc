# @repo/ui-extension

The UI surface. This package describes a view. It draws nothing.

Turbo tag: `extension`.

## Shape

`src/ui.ts` is the extension, `src/ui-host.ts` the host a root passes in,
`src/ui.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Nothing here imports a component. What draws a view lives in the frontend, which
takes the view from the seam and never names this package.

A new widget belongs on this surface, beside the others. What a widget can do is
part of what it describes, never a callback held outside it.

A view belongs to the REPL that produced it. An interaction with it is handled
nowhere else.

## Tests

`test/`. A test installs this extension and no other.
