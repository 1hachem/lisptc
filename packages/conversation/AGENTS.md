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

It is the only place the conversation is kept. Nothing above an extension sets
it, and another extension reads it through `conversationSlot`, never through a
global looked up by name.

What was said before this turn comes from the host's store. What happens during
the turn comes from the session's own chains, because a turn is stored only
once it ends.

One extension instance serves one session, so a root builds one per REPL.

At a composition root it comes before every extension that hooks `admit`, so it
records what they decided.

## Tests

`test/`. A test installs this extension and no other; its store is a stub
written there.
