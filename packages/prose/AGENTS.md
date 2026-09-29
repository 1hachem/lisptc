# @repo/prose-extension

The prose the model writes around its forms. This package owns the line between
text and form, and nothing above it draws that line itself.

Turbo tag: `extension`.

## Shape

`src/prose.ts` is the extension, `src/ports.ts` the contracts a host satisfies,
`src/prose-host.ts` the host a root passes in, `src/prose.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Which shapes count as prose is the host's decision. A new one is a classifier
the host carries, never a branch in this package.

What the model wrote and did not run leaves through the seam, never through an
import from a layer above.

The corpus tests are the specification of this surface. A change to what counts
as prose that no case catches is a change nobody can defend later.

## Tests

`test/`. A test installs this extension and no other.
