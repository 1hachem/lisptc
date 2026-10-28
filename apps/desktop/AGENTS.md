# @lisptc/desktop

The desktop shell. An Electron window over the served app, plus what only a
native process can do: open links in the system browser, own the lisptc://
scheme, and update itself.

Turbo tag: `product`.

## Shape

`src/main.ts` is the Electron main process, and the only entry. Electron loads
no TypeScript and no workspace package, so whatever the main process imports is
bundled before it ships. The packaging config lives in `package.json`.

`src/bridge.ts` is the desktop end of the MCP bridge, and `src/protocol.ts` is
its wire, the mirror of `apps/app/server/desktop/protocol.ts`.

## Rules

The window loads the served app and draws nothing of its own. A screen belongs
in `apps/app`, which every desktop user gets on the next load without a
release. A release is for a native change only.

The window runs sandboxed, with context isolation and no node integration. A
navigation off the app origin leaves the window for the system browser, so a
login provider never runs inside it.

**A change to the wire changes both protocol files and bumps
`PROTOCOL_VERSION` in both.** The server tells an older shell to upgrade
rather than guess at what it speaks, because a desktop updates later than the
app it talks to.

Nothing runs on the user's machine without their consent. Every new command
line is asked about before it starts, and "always allow" lasts for the run of
the app only.

The app URL comes from `@repo/env/desktop`, never from `process.env`.
