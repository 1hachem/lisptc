# Environment variables

Every variable this repo reads is declared and validated in `packages/env`
(`@repo/env`), one t3-env `createEnv` per area. Nothing else reads `process.env`;
`biome`'s `style/noProcessEnv` fails the build if it tries.

## Why one place

An environment variable is a string of unknown shape arriving from outside the
program. Read inline, each site invents its own coercion (`Number(...)`, `?? ""`,
`|| default`) and its own idea of what "unset" means — and an empty string, which
is what a shell exports for an unset-but-mentioned variable, reads as *set* to
half of them. Declaring it once in a zod schema settles the coercion, the default
and the failure mode together, and `emptyStringAsUndefined` makes an empty
variable mean unset everywhere.

The modules, by area: `api` (the app's origin), `server` (`PORT`), `ai`,
`analytics` (PostHog), `oauth`, `repl` (the session socket, `$LISPTC_SECRETS_FILE`,
`INIT_CWD`), `evals`, `providers`, `infisical`, `web` (the Vite client, reading
`import.meta.env`), plus one per MCP server under `mcps/`.

## Why `providers` lives here and not in `@repo/shared`

`@repo/shared` is the no-dependency layer, so it cannot import `@repo/env` — and
`@repo/env` reading `@repo/shared` is the direction that works. Shared keeps what
is pure (`PROVIDER_NAMES`, `DEFAULT_PROVIDER`, `providerSpecFor`, the
`ProviderSpec` shape); `@repo/env/providers` fills the table.

Two things fall out of that. Every default — model, base URL — is a zod `.default`
on the schema key rather than a `?? "..."` at the point of use, so `DO_MODEL` has
exactly one fallback. And `apiKeyEnv`, the variable name a "please set your key"
error prints, is *the schema key itself* (`key("DO_API_KEY")`, typed against
`keyof typeof providersEnv`): a rename of the variable that misses the error
message is a type error rather than a wrong instruction to the user. `llamacpp`
has no real key, so `LLAMACPP_API_KEY` defaults to `"llama.cpp"` — the local server
accepts anything — which keeps it on the same path as the other three instead of a
special case.

## The import-time snapshot, and what it costs tests

`createEnv` validates when the module is imported and returns a proxy over the
parsed object. The values are therefore a snapshot: mutating `process.env` after
that changes nothing.

In production this is what you want (fail at boot, not at the first request), but
it is a trap in tests. ESM evaluates a test file's imports before its body, so
setting a variable at the top of a test file is already too late — the module
graph, `@repo/env` included, has been evaluated. `packages/interpreter` and
`packages/repl` therefore set theirs in a vitest `setupFiles`
(`test/setup-env.ts`), which runs before the test module loads:

- `packages/interpreter/test/setup-env.ts` points `LISPTC_OAUTH_DIR` at a fresh
  temp dir, so `oauth-logout.test.ts` has a directory to assert on and no test can
  touch the developer's real `~/.config/lisptc/oauth`.
- `packages/repl/test/setup-env.ts` writes a `.env` holding `REPL_PI_TOKEN` and
  points `$LISPTC_SECRETS_FILE` at it, which is what makes
  "`AgentRepl` does not auto-load `$LISPTC_SECRETS_FILE`" a real assertion rather
  than a variable nobody set.

The other way out is a dynamic `import()` after the variables are set —
`packages/evals/test/runner.test.ts` points a provider at a local stub server
that way, and `packages/llm/test/llm-client.test.ts` pins one at an unroutable
host (`http://llamacpp.test/v1`) so the URL it asserts on is fixed and a stub
that failed to install cannot reach a real llama-server.

## The exemptions

Three kinds of `process.env` read survive in `src`, each with a `biome-ignore`
naming the reason, because no typed module can express them:

- **The whole environment, passed to a child.** `spawn`'s `env` in
  `mcp-runtime.ts`, the stdio `Endpoint` it hands back for the SDK to spawn, and
  `scripts/infisical-run.ts` all forward the parent environment wholesale; no
  value is read.
- **A name known only at runtime.** `expandEnv` in `mcp.ts` resolves `${VAR}` out
  of `mcp.toolkit.json`, where the variable is named by config.
- **A scan by prefix.** `EnvSecretsStore` collects every `REPL_*` name; the point
  of the prefix is that the set is open.

Test directories have the rule off too: a test *sets* variables, and that is the
one legitimate way to drive a module that reads them.

## Keeping a required secret out of the barrel

`createEnv` throws on import when a required variable is missing. A module with
required secrets must therefore stay out of `src/index.ts`, or importing
`@repo/env` anywhere would demand a Mistral key. `mcps/*` and `infisical` are
reachable only by their own subpath for that reason, and `infisical-run.ts` goes
further and `import()`s its module inside the command handler, so `--help` still
works with no credentials. `mcps/errors.ts` and `errors.ts` shape those failures
into a sentence that says which variable is missing and which `task` supplies it.
