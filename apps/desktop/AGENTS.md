# @lisptc/desktop

The desktop shell. An Electron window over the served app, plus what only a
native process can do: open links in the system browser, own the `lisptc://`
scheme, and update itself.

Turbo tag: `product`.

## Shape

`src/main.ts` is the Electron main process. esbuild bundles it to
`dist/main.cjs`, because Electron loads no `.ts` and no workspace package
unbundled. electron-builder packages `dist/` with the config in
`package.json`, and publishes the releases electron-updater reads back.

## Rules

The window loads the served app and draws nothing of its own. A screen belongs
in `apps/app`, which every desktop user gets on the next load without a
release. A release is for a native change only.

The window runs sandboxed, with context isolation and no node integration. A
navigation off the app origin leaves the window for the system browser, so a
login provider never runs inside it.

The app URL comes from `@repo/env/desktop`, never from `process.env`.
