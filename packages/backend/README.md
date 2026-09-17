# @repo/backend

The Convex deployment: the schema every other package reads through, the
functions that guard it, and the Better Auth instance whose database is Convex
itself.

Nothing here reaches the world on its own. The Hono API in `apps/api` serves the
auth router by proxying to this deployment's HTTP origin, and the web app in
`apps/app` subscribes to these functions directly.

## Running it

From the repo root:

```
task convex:up    # postgres + convex backend + dashboard, in docker compose
task convex:key   # mint an admin key, push the deployment's env, push the functions
```

Both run under Infisical: `/db` holds the postgres credentials and the database
name, `/convex` the deployment's own secret and its origins, `/auth` everything
Better Auth signs and calls out with. The backend keeps its data in the database
named after its instance, so one value in `/db` names both.

`convex:key` also reads `/auth`, and `scripts/convex-deploy.ts` pushes every
variable `@repo/env/convex` declares onto the deployment. Adding a deployment
secret means adding it there and to `/auth` — never to a file.

`convex:key` writes `packages/backend/.env.local` and is safe to re-run.
`pnpm --filter @repo/backend dev` then pushes on save and watches, and
`task convex:down -- -v` throws the deployment away.

Social sign-in needs `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (and the Google
pair) in `/auth`, with the OAuth app's callback pointing at the API:
`<AUTH_BASE_URL>/api/auth/callback/github`.
