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

Three `process.env` reads survive in `src`, each with a `biome-ignore` naming the
reason, because no typed module can express them:

- **The whole environment, passed to a child.** `spawn`'s `env` in
  `mcp-client.ts` (and `scripts/infisical-run.ts`) forwards the parent environment
  wholesale; no value is read.
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

## The Taskfile

`Taskfile.yml` is where a variable meets the secret that fills it: every task
that needs one wraps its command in `_infisical-run`, which fetches the named
Infisical paths and spawns the command with them in its environment. It carries
no comments, so the reasons live here.

**`_infisical-run` spawns `node` directly, not `pnpm tsx`.** pnpm exits 130 on
the Ctrl-C that reaches the whole process group, so every ordinary shutdown of a
dev server would be reported as a failed task. Running the script as task's own
child makes the exit code task sees the command's own.

**A build runs under the same secrets as the serve it feeds.** `start:app` and
`evals:open` each run `pnpm build && pnpm start` inside one `_infisical-run`,
because `VITE_*` and `NEXT_PUBLIC_*` are substituted at build time: a value
missing then is missing for good, and the page renders with the feature silently
absent rather than with an error. `turbo.json`'s `build` task lists both
prefixes in its `env` for the same reason — with `envMode: "loose"` and no such
list, two builds under different keys hash identically and turbo restores the
wrong bundle from its cache.

**`ENV` is a variable on every serving task**, so `ENV=prod task start:app`
serves against another Infisical environment without a second task.

**`mcp:ocr` and `mcp:sheets` exist for the interpreter, not for a human.** Both
toolkit entries in `mcp.toolkit.json` name the task as their `command`, so
`(load-mcp "ocr")` starts the server itself with its secrets already loaded.
See [the bundled MCP servers](./mcp-toolkit.md).

**`test:nix` re-runs `nix build` and `nix log` after `nix flake check`.** A
cached check prints nothing, so the stored ptcfmt summary is fetched back
explicitly and the pass count is always visible.
