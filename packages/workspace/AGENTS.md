# @repo/workspace-extension

The workspace as a language surface: its settings, and its chats.

Turbo tag: `extension`.

## Shape

`src/workspace.ts` is the extension, `src/ports.ts` the contracts a host
satisfies, `src/workspace-host.ts` the host a root passes in,
`src/workspace.ptc` the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A form that changes what the user decided, or brings another conversation into
this one, is in the extension's `asks`, so it waits on a human unless a rule
says otherwise. Adding such a form means adding it there.

The models, icons and themes on offer and the chat a session is in come from
the host. This
package knows no provider and opens no chat.

## Tests

`test/`. A test installs this extension and no other.
