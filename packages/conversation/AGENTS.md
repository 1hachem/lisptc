# @repo/conversation-extension

The conversation. What the session has said and run so far, as data the agent
reads and other extensions consume.

Turbo tag: `extension`.

## Shape

`src/conversation.ts` is the extension and its host interface,
`src/conversation-host.ts` the host a root passes in, `src/conversation.ptc`
the prompt.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

The `conversation` global in the image is the only copy of the conversation.
The extension keeps none in JS and no store: each change is applied straight to
that global, and the image carries it across turns. Nothing above an extension
sets it, and another extension reads it through `conversationSlot`, never
through a global looked up by name.

It learns what was said only through the `recorded` chain. The turn is what
reports each entry there; never derive the conversation from another hook.

The globals are sealed, so the agent reads them and never writes them.

## Tests

`test/`. A test installs this extension and no other, and runs `recorded`
itself.
