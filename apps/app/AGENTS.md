# app

The web frontend. TanStack Start and TanStack Router on Vite, with a Nitro
server directory for the routes that must run on the server.

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

## Rules

**The auth router is served here**, at this origin, not on the deployment. An
OAuth app's callback points at this app. `apps/api` verifies a token against the
deployment's JWKS instead, and the browser sends it the token this app holds.

Convex is subscribed to directly, through the query hooks, and the deployment's
declared entrypoints are the only surface. Do not reach into the deployment's
files.

Components come from `@repo/ui` for primitives, `@repo/components` for the
shared product pieces, `@repo/bloub` for the avatar and `@repo/syntax` for
highlighting the dialect. A primitive written here that has no product knowledge
belongs in `@repo/ui` instead.

**Every icon comes from hugeicons**, passed as the `icon` prop.
`check:arch` fails on `lucide-react`.

A message's extras arrive already shaped from the wire. Render them by lane.
Do not reach for a key an extension owns and do not reimplement its meaning
here.

## Tests

`test/` holds them, under happy-dom. `test/chat-turns.test.ts` and
`test/chat-transport.test.ts` are where the turn shaping and the stream contract
are pinned.
