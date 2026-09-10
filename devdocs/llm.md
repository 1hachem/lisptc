# Language models from inside the REPL

`llm/complete`, `llm/chat` and `llm/extract` let the Lisp the agent writes call a
model of its own. It is an interpreter extension like any other, and it lives in
its own package so that the interpreter does not have to know LangChain exists.

```
packages/llm/src/llm.ts          the built-ins, the shape-to-JSON-Schema conversion, the macros
packages/llm/src/llm-client.ts   the Generate port's default: ChatOpenAI per call, and toLangchain
packages/shared/src/providers.ts providerSpecs: the one table of base URLs, keys and default models
packages/shared/src/messages.ts  the chat-message shape, the roles, contentToText
```

## Why it is a package and not a file in the interpreter

The interpreter is the deterministic half of the system, and its dependency list
is part of that claim: `@modelcontextprotocol/sdk` for MCP, `dotenv` for
secrets, nothing else. LangChain pulls the OpenAI SDK and its transitive tree
behind it, which is a lot of surface for a package the LSP, the MCP server and
every test import. Because an extension is just `(interp) => void` and attaches
through `def` / hooks / channels, moving it out cost nothing but import paths:
`@repo/llm` depends on `@repo/interpreter`, never the other way round, and the
"extensions do not cross-import each other" rule is now a fact of the package
graph rather than a convention.

What the move needed from the core was two exports it should have had anyway:
`./plist` (the keyword-argument parser three extensions use) and the
`arrayToList` / `listToArray` pair, which had been copied into four modules.

### The LangChain import is lazy, and that is load-bearing

Moving the package did not by itself move the weight. `modelFacingExtensions()`
installs `llmExtension()` for every host, so a static
`import { ChatOpenAI } from "@langchain/openai"` in `llm-client.ts` made the LSP,
the MCP server, the CLI and every REPL test load LangChain and the OpenAI SDK at
startup, whether or not a model was ever called. Measured on a warm dev machine:
importing `@repo/repl/repl` went from 204ms to 462ms, all of it that one import.

So `llm-client.ts` holds only **type** imports of LangChain, which erase, and
`chatModel()` does `await import("@langchain/openai")` on the first real call.
`langchainGenerate` was already async, so nothing in the API changed. The
message-to-LangChain seam sits in its own module (`langchain.ts`) for the same
reason: `packages/ai` needs it eagerly, this package does not.

That regression is what broke CI, and it broke it somewhere unrelated:
`packages/ai/test/stream.test.ts` mocks `agent.ts`, which used to be the only
path to the OpenAI SDK, so its first test paid the new import inside its own 5s
timeout and went from 4773ms to 5232ms. Keep the load lazy, and keep an eye on
anything that adds a static import under `MemoryRepl`.

## Why the calls suspend instead of returning a promise

`load-mcp` returns a promise because a connect is worth overlapping with other
work. A model call is not: the next form almost always needs the text. So every
`llm/` built-in is an ordinary `interp.def` whose body returns a promise, which
the evaluator yields on and resumes with the value (see
[promises.md](./promises.md)). The consequence to keep in mind: the extension
installs **no** promise built-ins of its own. `Promises.installBuiltins` writes
`await`, `promises` and `cancel` as globals, and a second installation would
replace the MCP layer's copies with ones tracking a different `live` set. If
concurrent generation is ever wanted, the fix is one promise-returning built-in
(`interp.defPromise`) reusing the MCP layer's combinators, not a second
`Promises` instance.

The `:timeout` option (60s by default) is enforced with `withTimeout` from
`promises.ts`, and the `AbortController` behind it is aborted on the way out, so
a timed-out request stops rather than running on invisibly.

## A secret cannot reach a model

The string primitives are taint-aware only when `secretsExtension` is installed,
and a `Secret` is not a JS string. Every `llm/` built-in takes its text through
`asContent`, which accepts a string or **Lisp data** (a cons, a symbol, a
keyword, a number, `t`) and nothing else, so a prompt built with `concat` out of
`(secret "REPL_TOKEN")` is refused rather than sent. A `Secret` is a class
instance, so it fails that test the way a closure or a `Promise` does. That is
deliberate, and it is why `llm.ts` needs no import from `secrets.ts`: the MCP
reveal path (`toJSON`) is the only one, and this extension never takes it. A
secret nested inside a list is not a leak either, because `asContent` renders
with `str`, which prints a `Secret` redacted.

`asContent` renders anything that is not already a string with `str(x, false)`,
which is exactly what `(string x)` does, so passing an alist of records where a
prompt goes needs no wrapping. Four values are refused rather than rendered, and
each refusal is a bug caught early: **nil** (a variable that never got set,
which would otherwise be sent as the word `nil`), a **promise** (with `await it
first` in the message), a closure, and a `Secret`. `asText` survives for
`:model`, where a non-string is a mistake and rendering one would send a model
id nobody named.

## The shape language, and why it is not JSON Schema

`llm/extract` asks the caller for a *shape*, an alist of `(key . field)`, and
converts it to JSON Schema itself (`fieldFor`). Writing JSON Schema in Lisp
would cost the agent five lines of nested alists per field, and the parts it
would have to get right (`additionalProperties`, `required` listing every
non-optional key, `type: "object"` at the root) are exactly the parts a provider
rejects a request over. So the shape carries only what a caller decides:

| shape | JSON Schema |
| --- | --- |
| `:string`, `:number`, `:integer`, `:boolean` | `{"type": ...}` |
| `:any` | `{}` |
| `"what it means"` | `{"type":"string","description":"what it means"}` |
| `(:string "what it means")` | the same, for any scalar |
| `(:enum "a" "b")` | `{"type":"string","enum":["a","b"]}` |
| `(:list field)` | `{"type":"array","items":...}` |
| `(:optional field)` | the field, left out of `required` |
| an alist | an object, `additionalProperties: false` |

`shape` is the same language with the quoting taken out: `(shape (title
:string) (items (:list (id :number))))` expands to the quoted alist. It is a
macro, so it builds the alist at compile time and can therefore hold no computed
value — a caller with a runtime enum writes the alist itself, which still works
and is the reason the shape language stays the primitive and `shape` stays sugar
over it. Its one guess is where a group is a nested object rather than a field
form: a spec list whose head is a cons whose own head is **not** a keyword is a
group of `(name spec...)` clauses. That is what separates `(author (name
:string))` from `(tags (:list :string))`, and it is why `(:list ...)` and
`(:optional ...)` recurse through the same rule — `(items (:list (id :number)))`
has to reach the nested-object branch to mean a list of objects.

Every key is required unless wrapped in `(:optional ...)`: a model handed an
optional field fills it with a guess more often than it leaves it out, and the
whole point of extraction is that the answer is grounded in the text.

Structured output goes through LangChain's `withStructuredOutput(..., { method:
"jsonSchema" })`, so the constraint is the provider's own `response_format`
rather than a prompt asking for JSON. A top-level shape that is not an object
(a bare `(:list ...)`) is wrapped in a one-field object named `value` before the
call and unwrapped after, because `response_format` requires an object at the
root.

## The macros are Lisp, and run before the prelude

`summarize`, `summarize-each`, `llm/answer`, `shape` and `with-llm` are macros rather than
built-ins so that the prompt they build is program text the agent can read with
`(doc 'summarize)` and step around if it wants something else. They live in the
`MACROS` string at the bottom of `llm.ts`.

`llm/answer` is the one with a contract beyond its prompt. Grounding a model in a
context is half a feature without a defined answer for "the context does not
say", so its system message names a sentinel (`NOT-IN-CONTEXT`) and the expansion
turns that into **nil**. The alternative, handing the sentinel back as a string,
puts a magic value in front of an agent that will echo it to the user; nil is the
language's own "nothing", and `(if (llm/answer q ctx) ...)` reads the way the
question does. The match is a prefix, not an equality, because a model asked for
exactly one token still sometimes adds a full stop.

The trap: an extension runs in the `Interp` constructor, and the prelude is
loaded by the host *after* that. So `defmacro`, `defun`, `let` and `if` do not
exist yet when `MACROS` is evaluated. The definitions therefore use core forms
only, `(setq name (macro ...))` and `cond`, plus `_set-doc` (a core built-in) for
the documentation `defmacro` would otherwise have registered. Prelude names are
fine *inside* the templates and in expansion-time code, because a macro body is
expanded when the caller's form is compiled, long after the prelude has loaded.

`with-llm` restores `*llm-defaults*` in both exits, the value and the `catch`,
since the language has no `unwind-protect`. Its options are appended *after* the
saved ones so the inner block wins: `plistOptions` builds a `Map`, where the
last spelling of a key is the one that survives.

## What is traced, and by whom

The extension takes an `observe` callback (`LlmOptions.observe`) and calls it
once per model call, settled or failed: the built-in that made it, the resolved
provider and model, the messages in, the text out, latency, token counts, and
the error when there was one. It knows nothing about PostHog, which is right on
two counts: the interpreter package has no analytics dependency, and the CLI or
an MCP host that installs the extension gets no telemetry it never asked for.

The chain is three links, each the shortest it can be:

```
packages/llm/src/llm.ts        caller(): times the call, builds an LlmCall, never lets the observer throw
packages/repl/src/repl.ts      MemoryRepl.llmObserver, a mutable field the extension reads at call time
packages/ai/src/stream.ts      repl.llmObserver = (call) => captureLlmCall(trace, call)   per turn
packages/ai/src/telemetry.ts   captureLlmCall(): one $ai_generation, $ai_parent_id = the turn
```

The field is mutable and read late on purpose. A REPL outlives the turn that
created it (`repl-store.ts` keeps one per `thread_id`), so the observer has to
be re-pointed at the current turn's `TraceContext` on every turn, and a
`reset()` builds a fresh interp that must keep reporting to the same host. Both
fall out of the extension holding `(call) => this.llmObserver?.(call)` rather
than the observer itself.

An `llm/` call therefore renders as a **generation nested under the chat turn**,
beside the `$ai_generation` the agent's own step emits and the `$ai_span` the
REPL eval emits. `$ai_provider` and `$ai_model` on it are the sub-call's own,
never the agent's: `captureLlmCall` builds from `turnCommon` instead of
`common`, because PostHog derives cost from the model on the event, and
attributing a `summarize` on a cheap local model to the agent's own model would
put the cost on the wrong row. Token counts come from LangChain through a
`handleLLMEnd` callback in `llm-client.ts` rather than from the reply object,
because `withStructuredOutput` returns the parsed value and drops the
`AIMessage` that carries `usage_metadata`.

Set no `POSTHOG_API_KEY` and every capture is a no-op, so the traced and
untraced paths are the same code.

## What is configured where

`providerSpecs` in `@repo/shared/providers` is the single table of provider
label, API-key env var, base URL, default model and `body`. This extension, the agent
loop's `provider/` modules and the llama.cpp KV warmer all read it, so a base URL
or default model cannot drift between them. It lives in `@repo/shared` rather
than `@repo/env` because it is not environment: it is configuration that *reads*
the environment, and it is built by `buildProviderSpecs(env)`, a pure function of
a plain record, which is also how it is tested. `LLM_PROVIDER` names the provider
a call with no `:provider` gets; without it the default is `openrouter`,
matching the chat app. `@repo/env/ai` keeps only what is genuinely env and
genuinely not provider config (`LLAMACPP_SLOT_DIR`).

A spec's `body` is request-body fields that provider always needs, spread into
`modelKwargs` by both model builders (this extension's `chatModel` and the agent
loop's `defineProvider`), so a routing decision holds for an `llm/` call and an
agent turn alike. OpenRouter carries the only one: `provider: { only: [...] }`,
pinning every request to a single upstream, `sambanova` unless
`OPENROUTER_PROVIDER` says otherwise. OpenRouter otherwise picks an upstream per
request, and the upstreams disagree on quantization and on which body params they
honour, so an unpinned request is a different machine each time and neither a
grammar nor a latency figure means anything across two runs. The pin is also why
the model id carries no `:nitro` (or any other) variant suffix: a variant sorts
across providers, which is the choice `only` is taking away.

The extension deliberately does not reuse `packages/ai`'s `defineProvider`: that
builds a *streaming* model pinned to the `lisptc.gbnf` grammar, which is right
for the agent's own turns and wrong for a call the agent makes, where the reply
is text or JSON rather than Lisp.
