// Per-domain, validated environment (t3-env). Import a specific domain to keep
// validation scoped, e.g. `import { oauthEnv } from "@repo/env/oauth"`.
//
// `./web.ts` is deliberately not re-exported: it reads `import.meta.env`, which
// only exists inside a Vite build, so importing it from Node would break. The
// web app imports `@repo/env/web` directly.
export { aiEnv } from "./ai.ts";
export { analyticsEnv } from "./analytics.ts";
export { apiEnv } from "./api.ts";
export { oauthEnv } from "./oauth.ts";
export { replEnv } from "./repl.ts";
