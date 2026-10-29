# @repo/desktop-protocol

The wire between the desktop app and the app server: the messages each side
sends, the protocol version, and the ping cadence.

Turbo tag: `static`.

## Shape

`src/protocol.ts` is the whole package. `apps/desktop` speaks it from the
client end, and `apps/app/server/desktop` from the server end.

## Rules

This package is data. **A `static` package depends on a `foundation` package
at most**, and it reaches nothing at runtime, so the Electron bundle and the
server both load it.

**A change to the wire bumps `PROTOCOL_VERSION`.** The server tells an older
shell to upgrade rather than guess at what it speaks, because a desktop
updates later than the app it talks to.
