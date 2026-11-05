# @repo/models

How the code reaches a model vendor: the chat providers and the System One
models. It carries langchain and `@typesafe-ai/sdk` so that every caller shares
one implementation of each.

Turbo tag: `platform`.

## Shape

`src/chat.ts` builds a chat provider from a provider spec and its default
options. `src/system-one.ts` is the OpenRouter `SystemOneModel`, against the
contract in `@repo/shared/system-one`. `src/providers.ts` binds both to the
environment: the chat provider registry and `jev`.

## Rules

A provider sets defaults, and a caller overrides any of them per call. `null`
turns a default off. A caller that needs different settings passes options,
never forks the provider.

`src/chat.ts` and `src/system-one.ts` read nothing from the environment. They are
configured by what they are handed, so `src/providers.ts` is the only file that
imports `@repo/env`.

A `platform` package depends on `foundation` and `static` packages only.
Extensions, the runtime, the backend and the apps depend on it, never the other
way.

A new vendor is a new file beside the others and an entry in
`src/providers.ts`. A contract two layers share goes in `@repo/shared`, not here.

## Tests

`test/`. A provider is tested through what it builds, and a System One model
through a stubbed `fetch`. Neither calls a vendor.
