# app

The web frontend and the server that streams the agent loop. TanStack Start
and TanStack Router on Vite, with a Nitro server directory for the routes that
must run on the server.

Turbo tag: `product`.

## Shape

`src/routes/` is the route tree, file-based, generated into `routeTree.gen.ts`.
Never edit the generated file. `__root.tsx` sets up auth, the Convex client and
analytics; `login.tsx` is the only unauthenticated page; `_authed.tsx` is the
layout that loads the current user and the workspace list, and everything under
`_authed/$workspaceId/` is the product.

`src/components/` holds the views, `src/lib/` the state and the glue: the chat
session store, the agent state, the workspace context, the auth client, the
transcript and turn shaping, the command list, analytics.

`server/` is Nitro. `server/routes/api/auth/[...path].ts` serves the Better Auth
router at this app's own origin, and `server/routes/ingest/[...path].ts` proxies
analytics. `src/styles/app.css` pulls in the design system's stylesheet.

`server/agent/` is the agent, served as TanStack Start server routes. A route
file under `src/routes/` binds a path and its methods to a handler from
`server/agent/` and does nothing else. Each handler carries its own request
middleware: `edge.ts` lists the chain every one runs (telemetry, the request
log, the single error handler in `error.ts`), and `session.ts` adds the
authenticated chain on top of it. `body.ts` validates a request body against its schema and hands the
handler the parsed value. `chat.ts` serves the chat stream, the steering and
the direct evaluation, `ui-action.ts` an action the browser sent back,
`oauth-callback.ts` the end of an MCP authorization, `health.ts` the health
check. `session.ts` verifies a bearer token against the deployment's JWKS and
is the only place a caller identity is established.
`convex.ts` and `ids.ts` talk to the deployment as that caller, `history.ts`
converts between a wire message and a stored one, `model.ts` names the provider
and model, `telemetry.ts` wires PostHog.

## Rules

**The auth router is served here**, at this origin, not on the deployment. An
OAuth app's callback points at this app. The browser reaches the agent on this
same origin too, never on a host of its own.

Convex is subscribed to directly, through the query hooks, and the deployment's
declared entrypoints are the only surface. Do not reach into the deployment's
files.

Components come from `@repo/ui` for primitives, `@repo/components` for the
shared product pieces, `@repo/bloub` for the avatar and `@repo/syntax` for
highlighting the dialect. A primitive written here that has no product knowledge
belongs in `@repo/ui` instead.

A control, a menu row, an icon or a dialog written here takes its size from the
`@repo/ui` tokens (`h-control`, `h-row`, `size-icon`, `max-w-dialog`), never
from Tailwind's defaults. `packages/ui/AGENTS.md` holds the scale.

**Every icon comes from hugeicons**, passed as the `icon` prop.
`check:arch` fails on `lucide-react`.

A message's extras arrive already shaped from the wire. Render them by lane.
Do not reach for a key an extension owns and do not reimplement its meaning
here.

The agent carries bytes, it does not interpret them. The turn events and the
annotation lanes come out of `@repo/ai` already shaped, and a route writes them
to the wire without unpacking a key. If a payload has to be interpreted here,
the interpretation belongs below the seam, in the extension that produced it.

A route never names an extension. It builds a turn and streams what comes back.

`server/agent/` holds routes and the wiring a route needs, and no logic of its
own. A codec, a cache, a store belongs to the layer whose shape it knows: a
store the REPL talks to arrives whole from `@repo/backend/src`, already
satisfying the port, and anything an extension has to interpret belongs in its
`-host.ts`. `check:arch` reads `apps/app/server/agent` as a carrier tree and
fails on a value imported from an extension module. A type import is all a
composition root needs.

Identity comes from the verified token, never from the request body. A handler
reads it through the session, and a new route that touches the deployment goes
through the same middleware.

A request envelope is validated by its schema at the edge, through `body()` in
the handler's middleware, never parsed inside the handler. Add the field to the
schema before reading it.

The agent keeps each chat's REPL, its steering inbox and its pending system
events in this process. The app runs as one replica, and a rollout replaces it
rather than running two side by side.

A prompt the served agent runs on ships only because this app says so. An
extension added to that agent is named in `runtime-assets.ts` too, or it is
served without its prompt. `test/agent/runtime-assets.test.ts` fails on a
prompt a module asks for at runtime and the build does not ship.

## Tests

`test/` holds them, under happy-dom. `test/chat-turns.test.ts` and
`test/chat-transport.test.ts` are where the turn shaping and the stream contract
are pinned. `test/agent/` covers the server: `chat-request.test.ts` pins the
request envelope and `session.test.ts` the token path. A test there runs a handler
through its whole middleware chain with `serve` from `test/helpers.ts`, never
the handler alone.
