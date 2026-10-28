# app

The web frontend and the server that streams the agent loop. TanStack Start
and TanStack Router on Vite, with a Nitro server directory for the routes that
must run on the server.

Turbo tag: `product`.

## Shape

`src/routes/` is the route tree, file-based, generated into `routeTree.gen.ts`.
Never edit the generated file. `__root.tsx` sets up auth, the Convex client and
analytics; `_authed.tsx` is the layout that loads the current user and the
workspace list, and everything under `_authed/$workspaceId/` is the product.
`login.tsx` and `download.tsx` are the only unauthenticated pages, beside the
landing page a signed-out visitor sees at `/`. Any other signed-out visit
lands on login.

`src/components/` holds the views, `src/lib/` the state and the glue: the chat
session store, the agent state, the workspace context, the auth client, the
transcript and turn shaping, the command list, analytics.

`server/` is Nitro. `server/routes/api/auth/[...path].ts` serves the Better Auth
router at this app's own origin, and `server/routes/ingest/[...path].ts` proxies
analytics. `src/styles/app.css` pulls in the design system's stylesheet.

`server/routes/api/desktop.ts` is the one websocket, where the desktop app
connects. `server/desktop/` holds what it speaks and the registry that hands a
user's :local MCP servers to that user's desktop. It is a Nitro route because
TanStack Start serves no websocket. The wire is `@repo/desktop-protocol`, and
its `AGENTS.md` says how a change to it ships.

`server/agent/` is the agent. It is served as TanStack Start server routes and
takes no other HTTP framework. A route file under `src/routes/` binds a path to
a handler from `server/agent/` and holds no logic. Cross-cutting behaviour
belongs in request middleware declared beside the handler, never inline in it.
A caller identity is established in one place only, and every handler that
touches the deployment runs behind it.

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

**Everything in the chat stays inside its bounds**, whatever a message, a
question or a drawn view carries. Text wraps where it can, truncates where it
cannot, and collapses when it is long; it is never clipped, and nothing scrolls
the chat sideways. Every row item that holds text can shrink. `sidewaysLeaks`
in `test/helpers.ts` is the check, and a new part of the chat or the composer
is rendered under it with text wider than the pane.

A message's extras arrive already shaped from the wire. Render them by lane.
Do not reach for a key an extension owns and do not reimplement its meaning
here.

The agent carries bytes, it does not interpret them. The turn events and the
annotation lanes come out of `@repo/ai` already shaped, and a route writes them
to the wire without unpacking a key. If a payload has to be interpreted here,
the interpretation belongs below the seam, in the extension that produced it.

A route never names an extension. **`server/agent/` posts, watches and
answers. It never starts a turn itself.** A message, a steer, an ask's
follow-up and a sub-agent's notice are each posted to the chat's thread, and
the thread decides when a turn runs. A route streams what the thread sends
back, and satisfies the ports the thread declares.

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

The agent keeps each chat's REPL, its thread and what waits in its mailbox in
this process. The app runs as one replica, and a rollout replaces it
rather than running two side by side.

A prompt the served agent runs on ships only because this app says so. An
extension added to that agent is named in `runtime-assets.ts` too, or it is
served without its prompt. `test/agent/runtime-assets.test.ts` fails on a
prompt a module asks for at runtime and the build does not ship.

## Preferences

**Every preference the user can set here, the agent can set too.** A new one
is added to `packages/preferences` in the same change: its forms read and write
it, its prompt names it, and a test there sets it. A preference this app stores
and that extension does not expose fails the rule.

## Tests

`test/` holds them, under happy-dom. `test/chat-turns.test.ts` and
`test/chat-watch.test.ts` are where the turn shaping and the stream contract
are pinned. `test/agent/` covers the server: `chat-request.test.ts` pins the
request envelope and `session.test.ts` the token path. A test there runs a handler
through its whole middleware chain with `serve` from `test/helpers.ts`, never
the handler alone.
