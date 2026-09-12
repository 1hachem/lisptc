## Prompts

An extension carries the prompt that teaches its capability, as a `.ptc` file
beside its source, and **installing the extension installs the prompt**. So the
reference an interpreter hands out describes the interpreter you actually built:
a REPL with no `mcpExtension` never tells the model to call `load-mcp`.

`src/prompt.ts` owns the seam, and it names no extension, the way `hooks.ts` and
`channels.ts` do not:

- `promptSection(id, url)` reads a `.ptc` file into a `{ id, text }` pair. Each
  extension holds one as a module constant: `MCP_PROMPT`, `SECRETS_PROMPT`,
  `LLM_PROMPT`, and so on. `CORE_PROMPT` in `src/source.ts` is `SKILL.ptc`, the
  core language, and `Interp` seeds it in the constructor.
- `Interp.prompts` is a `Prompts` registry, beside `hooks` and `channels`. A
  registration function adds its own section as it installs
  (`registerMcp`, `registerSecrets`, `registerCompaction`, `registerLlm`,
  `proseExtension`, `Promises.installBuiltins`). `add` dedupes by `id`, which is
  what lets `Promises.installBuiltins` add the promises section without caring
  how many extensions reach it.
- `prompted(fn, sections)` also **carries** the same constants on the extension
  function, the way `compactionExtension` carries its `compactor`. That is the
  path for a host that wants the reference without building an interpreter:
  `promptOf` reads them back, and `referenceFor(CORE_PROMPT, extensions)`
  composes the document. `languageReference()` in `@repo/repl/extensions` is that
  call over the default roster, and `MemoryRepl.languageReference` is the live-interp
  equivalent. Both read the same constants, so they cannot drift, and
  `packages/repl/test/prompt.test.ts` pins that they agree.

`packages/ai` builds the system prompt from whichever of the two it has:
`SYSTEM_PROMPT` is `systemPrompt(languageReference())` for the default roster,
and `runAgentTurn` sends `systemPrompt(repl.languageReference)` when no `system`
was configured, so an eval running a mocked roster is prompted for that roster.

Sections compose in install order and cross-reference each other **by name**
rather than by number, since any of them can be absent. That is why the files
carry no `§N` headings.

## Extension list

here is a list of extensions added to the interpreter:

- [x] mcp
- [x] context compaction
- [x] prose permissiv
- [x] ai features
- [ ] generative ui
- [ ] permissions (deny, allow, auto and ask, on forms and params) not pattern matching, but on the interpreter level
- [x] evals and checks (`packages/evals`, see [evals.md](./evals.md))
- [ ] agents orchestrations
- [ ] memory (code persistance and self-modification)
- [ ] hooks (memories attached to lifecycle events)
- [ ] settings (model config)
- [ ] budgetting and limits
- [ ] triggers (cron, events)

- [ ] scratch pad?? to test parsing and utility processing form, and lisp sheninegins away from the user
