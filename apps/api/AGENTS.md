# api

An HTTP server streaming the agent loop. Hono on the node adapter.

Turbo tag: `product`.

## Shape

`src/index.ts` starts the server and `src/app.ts` assembles it: the middleware,
the routers and the health check. `src/chat.ts` serves the chat stream and the
direct evaluation, `src/ui-action.ts` serves an action the browser sent back.
`src/error.ts` is the single error handler.

`src/session.ts` is the seam with auth: it verifies a bearer token against the
deployment's JWKS, and it is the only place a caller identity is established.
`src/convex.ts` and `src/ids.ts` talk to the deployment as that caller.
`src/history.ts` converts between a wire message and a stored one,
`src/memory-codec.ts` between a stored memory row and the dialect's shape.
`src/model.ts` names the provider and model, `src/telemetry.ts` wires PostHog.

## Rules

This app carries bytes, it does not interpret them. The turn events and the
annotation lanes come out of `@repo/ai` already shaped, and a route writes them
to the wire without unpacking a key. If a payload has to be interpreted here,
the interpretation belongs below the seam, in the extension that produced it.

A route never names an extension. It builds a turn and streams what comes back.

Identity comes from the verified token, never from the request body. A handler
reads it through the session, and a new route that touches the deployment goes
through the same middleware.

A request envelope is validated by its schema at the edge. Add the field to the
schema before reading it in a handler.

## Tests

`test/chat-request.test.ts` pins the request envelope,
`test/session.test.ts` the token path, `test/memory-codec.test.ts` the
round trip. A test hits the app rather than a handler in isolation.
