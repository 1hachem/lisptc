# @lisptc/desktop

The desktop shell. An Electron window over the served app, plus what only a
native process can do: open links in the system browser, own the lisptc://
scheme, and update itself.

Turbo tag: `product`.

## Shape

`src/main.ts` is the Electron main process, and the only entry. Electron loads
no TypeScript and no workspace package, so whatever the main process imports is
bundled before it ships. The packaging config lives in `package.json`.

`src/bridge.ts` is the desktop end of the MCP bridge. Its wire is
`@repo/desktop-protocol`, which the server speaks too.

## Rules

The window loads the served app and draws nothing of its own, except the
loading screen shown while the app cannot be reached yet. A screen belongs
in `apps/app`, which every desktop user gets on the next load without a
release. A release is for a native change only.

The window runs sandboxed, with context isolation and no node integration. A
navigation off the app origin leaves the window for the system browser, so a
login provider never runs inside it.

Nothing runs on the user's machine without their consent, and the
permissions extension is where it is given. A local server is the call
`local/<server>`, asked or allowed like any other before the server ever sends
`open`, and an "always allow" is saved to the workspace's permissions config.
The shell runs what it is opened with and asks nothing itself.

An update is checked for while the app runs, not only at launch, because the
app lives in the tray for days. It installs only when the user restarts for
it, from the tray or the bottom bar.

The app URL comes from `@repo/env/desktop`, never from `process.env`.
