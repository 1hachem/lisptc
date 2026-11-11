---
name: convex-dev-better-auth
description: Provides an integration layer for using Better Auth with Convex. Use this skill whenever working with Better Auth or related Convex component functionality.
version: 0.13.0
---

> Agents: read this skill fully before writing code that uses Better Auth. Follow the installation and configuration steps exactly.

# Better Auth

## Instructions

This component provides an integration layer for using Better Auth with Convex, enabling framework-agnostic authentication across React, Vue, Svelte, Next.js, and other popular frameworks. It handles email/password authentication, OAuth providers (GitHub, Google, Discord, Twitter), and multi-factor authentication while managing sessions and accounts through Convex's database.

### Installation

```bash
npm install @convex-dev/better-auth
```

Current npm version: `@convex-dev/better-auth@0.13.0`

## Use cases

- **Building a multi-framework app** where you need consistent authentication across React, Vue, Svelte, or other frontend frameworks using the same Convex backend
- **Adding social login** to your Convex app with support for GitHub, Google, Discord, Twitter, and other OAuth providers without managing provider-specific integration logic
- **Implementing secure user accounts** with email/password authentication, session management, and two-factor authentication using Convex for data persistence
- **Migrating from another auth solution** to Better Auth while keeping your existing Convex database schema and functions intact
- **Building SSR applications** with Next.js, Nuxt, or Astro that need server-side authentication handling integrated with your Convex backend

## How it works

The component acts as a bridge between Better Auth's authentication system and Convex's database and functions. Better Auth handles the authentication logic, session management, and OAuth provider integrations, while the component ensures all user data, sessions, and account information are stored and managed through your Convex backend.

The integration works by configuring Better Auth to use Convex functions for data persistence operations. When users sign up, sign in, or manage their accounts, Better Auth communicates with your Convex functions to store and retrieve user data, maintaining consistency with your existing Convex schema.

For multi-factor authentication and social sign-on, the component leverages Better Auth's built-in providers while ensuring all authentication state flows through Convex. This allows you to use Convex's real-time subscriptions and query capabilities with authenticated user data across any supported framework.

## When NOT to use

- When a simpler built-in solution exists for your specific use case
- If you are not using Convex as your backend
- When the functionality provided by Better Auth is not needed

## Resources

- [npm package](https://www.npmjs.com/package/%40convex-dev%2Fbetter-auth)
- [GitHub repository](https://github.com/convex/better-auth)
- [Live demo](https://labs.convex.dev/better-auth)
- [Convex Components Directory](https://www.convex.dev/components/better-auth)
- [Convex documentation](https://docs.convex.dev)

## TanStack Start

Source: https://labs.convex.dev/better-auth/framework-guides/tanstack-start. The guide needs `convex >= 1.25.0` and pins `better-auth@~1.7.16`. Full example: https://github.com/get-convex/better-auth/tree/main/examples/tanstack. The snippets below fix bugs in the guide's own copies: a diff rendered without its markers, a missing import, a syntax error and a wrong function name.

### Install

```bash
pnpm add convex@latest @convex-dev/better-auth better-auth@~1.7.16
pnpm add -D @types/node
```

### Vite: bundle the component during SSR

`vite.config.ts`:

```ts
export default defineConfig({
  ssr: {
    noExternal: ['@convex-dev/better-auth'],
  },
});
```

### Convex side

`convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();
app.use(betterAuth);

export default app;
```

`convex/auth.config.ts`:

```ts
import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
```

`convex/auth.ts`:

```ts
import { betterAuth } from 'better-auth/minimal'
import { createClient } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import authConfig from './auth.config'
import { components } from './_generated/api'
import { query } from './_generated/server'
import type { GenericCtx } from '@convex-dev/better-auth'
import type { DataModel } from './_generated/dataModel'

const siteUrl = process.env.SITE_URL!

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [convex({ authConfig })],
  })
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx)
  },
})
```

The `convex({ authConfig })` plugin is required. `requireEmailVerification: false` is the guide's starter setting, not a production one.

`convex/http.ts`:

```ts
import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

export default http;
```

### Environment

On the Convex deployment:

```bash
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
```

On the app side: `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL` (`.convex.cloud`), `VITE_CONVEX_SITE_URL` (same deployment, ends in `.site`), `VITE_SITE_URL`.

### App side

`src/lib/auth-client.ts`:

```ts
import { createAuthClient } from 'better-auth/react'
import { convexClient } from '@convex-dev/better-auth/client/plugins'

export const authClient = createAuthClient({
  plugins: [convexClient()],
})
```

`src/lib/auth-server.ts`:

```ts
import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start'

export const {
  handler,
  getToken,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthReactStart({
  convexUrl: process.env.VITE_CONVEX_URL!,
  convexSiteUrl: process.env.VITE_CONVEX_SITE_URL!,
})
```

A custom Better Auth `basePath` has to be the same in four places: `convexBetterAuthReactStart`, the `convex` plugin's `options.basePath`, `getAuthConfigProvider({ basePath })` and the auth client. Move the route file below to match.

`src/routes/api/auth/$.ts` proxies auth requests to the Convex site URL:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { handler } from '~/lib/auth-server'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
    },
  },
})
```

`src/router.tsx`:

```tsx
import { createRouter } from '@tanstack/react-router'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexProvider } from 'convex/react'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  if (typeof document !== 'undefined') {
    notifyManager.setScheduler(window.requestAnimationFrame)
  }

  const convexUrl = (import.meta as any).env.VITE_CONVEX_URL!
  if (!convexUrl) {
    throw new Error('VITE_CONVEX_URL is not set')
  }
  const convexQueryClient = new ConvexQueryClient(convexUrl, {
    expectAuth: true,
  })

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    context: { queryClient, convexQueryClient },
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <ConvexProvider client={convexQueryClient.convexClient}>
        {children}
      </ConvexProvider>
    ),
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}
```

`src/routes/__root.tsx`: read the token from cookies in a GET server function, hand it to the SSR HTTP client, and seed the provider with it.

```tsx
import { createRootRouteWithContext, Outlet, useRouteContext } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { authClient } from '~/lib/auth-client'
import { getToken } from '~/lib/auth-server'

const getAuth = createServerFn({ method: 'GET' }).handler(async () => {
  return await getToken()
})

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}>()({
  beforeLoad: async (ctx) => {
    const token = await getAuth()
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    return { isAuthenticated: !!token, token }
  },
  component: RootComponent,
})

function RootComponent() {
  const context = useRouteContext({ from: Route.id })
  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      authClient={authClient}
      initialToken={context.token}
    >
      <Outlet />
    </ConvexBetterAuthProvider>
  )
}
```

`serverHttpClient` exists only during SSR, so `setAuth` there authenticates the SSR queries and nothing else.

### Rules

- **SSR queries.** Load them with `ensureQueryData(convexQuery(...))` in a loader and read them with `useSuspenseQuery`. A clean first render needs `expectAuth: true` on `ConvexQueryClient`, so no Convex function runs on the client before auth is ready.
- **Sign-out.** `expectAuth` only holds until the first authentication. After a sign-out and sign-in in the same page, queries run before auth and throw. Reload on sign-out:

  ```ts
  await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        location.reload();
      },
    },
  });
  ```

- **`auth.api` runs only inside a Convex function**, never in TanStack Start server code. Get the instance and the session headers with `authComponent.getAuth(createAuth, ctx)`. Call the function from the client with a hook, or from server code with `fetchAuthQuery`, `fetchAuthMutation` or `fetchAuthAction`. Those carry the session cookie for you.

  ```ts
  export const updateUserPassword = mutation({
    args: { currentPassword: v.string(), newPassword: v.string() },
    handler: async (ctx, args) => {
      const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
      await auth.api.changePassword({ body: args, headers });
    },
  });
  ```

  ```ts
  export const updatePassword = createServerFn({ method: "POST" }).handler(
    async ({ data: { currentPassword, newPassword } }) => {
      await fetchAuthMutation(api.users.updateUserPassword, {
        currentPassword,
        newPassword,
      });
    }
  );
  ```

- **The guide is silent on `trustedOrigins`, CORS and cookie options.** Check them against Better Auth's own docs, not this guide.