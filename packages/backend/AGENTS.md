# @repo/backend

The Convex deployment: the schema every other package reads through, the
functions that guard it, and the Better Auth instance whose database is Convex
itself. Its source lives in `convex/`, not `src/`.

Turbo tag: `platform`.

## Shape

`convex/schema.ts` is the source of truth for the data. Every table, every
field, every index. Nothing else in the repo redeclares them.

One module per resource, each holding the queries and mutations that guard it:
workspaces, chats, messages, users, memories. `convex/lib/auth.ts` holds the
guards those modules call to resolve the caller and check ownership, and every
public function starts with one. `convex/lib/` also holds the small pure helpers
beside them.

`convex/auth.ts` sets up Better Auth against the deployment, with the triggers
that keep the `users` table and a first workspace in step with the auth user,
and the cascade that runs when one is deleted. `convex/auth.config.ts` and
`convex/http.ts` serve it: the HTTP router registers the auth routes.
`convex/convex.config.ts` declares the components the deployment uses, and
`convex/migrations.ts` holds the runner.

`convex/_generated/` is generated. Never edit it, and never hand-write what
belongs there.

`src/` holds what runs outside the deployment against it: the memory store a
REPL talks to, and the codec between a stored row and a domain value. Anything
reaching in from another package goes through an entrypoint in `package.json`,
never into the deployment's files.

## Rules

Nothing above this package reaches past the declared entrypoints. `apps/app`
subscribes to the functions directly and serves the auth router at its own
origin. `apps/api` verifies a token against that origin's JWKS instead. The
OAuth callback points at the web app, never at the deployment.

A public function takes the caller from the context, never from an argument, and
resolves ownership before it touches a row. Read the guards in `convex/lib/`
before writing a new one.

The deployment carries an environment of its own, and nothing in this repo
pushes it. A secret lives in Infisical under `/auth` and is set on the
deployment by hand, from the dashboard, never written to a file.

A schema change on a live deployment goes through a migration, and the runner is
already here.

Size limits belong to the data, so they live in `convex/limits.ts` and are
enforced where a row is written.

## Commands

```bash
pnpm --filter @repo/backend dev        # push functions on save and watch
pnpm --filter @repo/backend test       # convex-test, in memory
```

`dev` wants `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` in its
environment. Under `task`, Infisical supplies them.

## Tests

`test/helpers.ts` builds a signed-in world. Use it rather than assembling
identities by hand. `test/access.test.ts` and `test/removal.test.ts` are where
the ownership and cascade rules are pinned, and a new resource needs a case in
both.
