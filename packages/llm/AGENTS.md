# @repo/llm

The language-model extension. It carries `@langchain/core` and
`@langchain/openai` so the interpreter never has to, which is a rule
`pnpm check:arch` enforces on the interpreter's manifest.

Turbo tag: `extension`.

## Shape

`src/llm.ts` is the extension. It declares `LlmHost`, one field per port
(generation, the provider list, the clock, its own prompt), and exports
`llmExtension`, which takes the host as a default argument. This extension
contributes both a `prompt` and a `session`, and its session hook fills a slot.
`src/llm-host.ts` holds the default host. `src/llm.ptc` is the prompt.

`@repo/interpreter/observe` is the observation contract and the slot it hands
over. It is a module separate from the extension on purpose: a consumer reads
the slot without importing what fills it. `src/llm-client.ts` and
`src/langchain.ts` are the vendor-facing implementations, and they are the only
files that speak langchain.

`check:arch` treats `src/llm.ts` as an extension module, so it imports no
`node:` builtin, no typed env module, no langchain package and no
`process.env`.

## Rules

Read the host-port and seam rules in `packages/interpreter/AGENTS.md`. They
govern this package.

A new provider is a provider entry, not a branch inside the extension. A new
thing to observe is a field on the observation contract beside the slot, never
a type imported from a layer above.

## Tests

`test/llm.test.ts` and `test/llm-client.test.ts`. A test stubs the generate port
rather than calling a model.
