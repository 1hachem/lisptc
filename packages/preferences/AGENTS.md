# @repo/preferences-extension

A workspace's preferences as a language surface: the font, which metadata
fields the chat shows, and how the app lays itself out. The theme is a
workspace setting too, and it lives in `packages/workspace`.

Turbo tag: `extension`.

## Shape

`src/preferences.ts` is the extension, `src/ports.ts` the contracts a host
satisfies, `src/preferences-host.ts` the host a root passes in,
`src/preferences.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Preferences belong to a workspace, and each one keeps its own. The store a
root hands in is already bound to the workspace of the chat, and this package
never learns which one that is.

What can be chosen comes in through the host: the fonts, the metadata
fields and the input helpers as data, and what the store already holds is
what a change is checked against. This package names none of them.

The memories name no value code holds. Each one is a `{{placeholder}}` the
extension fills from the host or from its own constants when it loads them,
and a test fails on one left unfilled.

Every preference the app lets the user set is one this package exposes. Read
the Preferences section in `apps/app/AGENTS.md` before adding one.

## Tests

`test/`. A test installs this extension and no other.
