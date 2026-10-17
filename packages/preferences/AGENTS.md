# @repo/preferences-extension

The user's preferences as a language surface: the theme, the font, and which
channels and metadata fields the chat shows.

Turbo tag: `extension`.

## Shape

`src/preferences.ts` is the extension, `src/ports.ts` the contracts a host
satisfies, `src/preferences-host.ts` the host a root passes in,
`src/preferences.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

Preferences belong to a user, not a workspace. The store a root hands in
reads and writes as the person in the chat, and this package never learns who
that is.

What can be chosen comes in through the host: the themes and fonts as data,
the channel and metadata ids as whatever the store already holds. This
package names none of them.

## Tests

`test/`. A test installs this extension and no other.
