# The agent loop

`packages/ai`, plus the two `apps/api` routes that drive it. The agent has **no
tools**: the model is grammar-constrained so every reply IS a Lisptc program, the
program is evaluated, and the REPL's output is fed back as the next turn's input.

```
model turn (text = a Lisp program)
  → AgentRepl.evalOutput
  → {"type":"tool_result","source":"lisp-repl","error":…,"output":…}
  → next model turn
until a form-less (pure prose) reply, or MAX_STEPS
```

That form-less reply is the answer to the user: it is streamed like any other
assistant turn but produces no REPL result.

## What must not leak into the model's context

`content` carries the **capped** output. The client replays the message list as
the next request's input and the model's context is rebuilt from `content` alone,
so uncapped text there would re-enter that context on every later turn. The full
output rides in `additional_kwargs.display`, which only the UI reads — the same
channel `reasoning_content` uses.

There is no reason to truncate a page a human reader can simply scroll.

## Per-call accounting, never summed

Every model call is handed the whole conversation as it stood for that call, so
each step's input token count **already contains the ones before it**. Adding
them across the loop charges the same prompt several times over.

`steps` is the one exception: it belongs to the turn, not the call, so it hangs
off the message the reader ends on and nowhere else.

`cachedInput` is a **subset** of `input`, not an extra. Absent when the provider
says nothing about caching, which is not the same as a cold prompt. A backend
that reports no usage simply never produces a usage delta, and the turn goes
uncounted rather than counted wrong.

### The stream test imports in a hook, not in a test

`test/stream.test.ts` drives the real `streamChatResponse` with `agent.ts`
mocked, so its first test used to pay the whole module graph inside a test's 5s
budget: 4773ms of 5000 on a CI runner, and a single new import under
`MemoryRepl` tipped it over. The import now happens in `beforeAll`, which has
its own 10s budget, and each test measures only what it is about (~60ms). Any
test that pulls a heavy graph belongs in a hook for the same reason.

## Stream plumbing

The client tears the fetch down (and re-issues it) whenever dev tools open or the
tab reloads. Once that happens `controller.enqueue` throws, so every write is
guarded and the abort is propagated to the upstream model call — otherwise the
unhandled error takes the server process down.

The response headers went out long ago, so the `console.error` on a failed model
call is the **only** place it is ever reported: without it the failure reaches
the browser as an SSE `error` event and the server says nothing. Likewise the
closing `console.log` outlives the request log line and is the only record of how
a chat turn actually finished.

A turn always gets a trace id, even without a chat identity: an ephemeral run is
still worth measuring, it just groups only with itself.

Withheld prose feedback (see [repl.md](./repl.md)) is pushed into the transcript
but deliberately **not** into `wire`: it is a note to the model, not a message to
the user, and it should not come back on the next replayed transcript. It has to
say out loud that it is not from the user and not to be answered — the failure
mode is a model that opens its reply apologising for a mistake the user never
saw.

## Per-thread REPL persistence

The HTTP API is otherwise stateless: the client replays the whole transcript each
turn so the model keeps its *textual* context. But the interpreter STATE —
definitions, loaded MCP servers, accumulated bindings — is not in that transcript,
so a fresh `AgentRepl` per request would silently drop everything the agent built
up earlier in the chat.

One long-lived `AgentRepl` per `thread_id` fixes that. Insertion order in the Map
doubles as LRU recency: a touched thread is re-inserted at the end, so the
least-recently-used is always `keys().next()`. No thread id means an ephemeral
REPL, preserving the old stateless behaviour.

Eviction does **not** yet release the thread's MCP clients (`TODO` in
`repl-store.ts`).

A thrown error from `evalCode` means an unexpected *host* error — the REPL renders
Lisp errors into its output rather than throwing — so the interpreter is reset to
avoid persisting corrupt state.

## Providers and grammars

Constraining generation is the point of this package: an unconstrained model
emits prose the REPL cannot evaluate. So a provider is grammar-constrained unless
its spec says otherwise, and `grammarResponseFormat` — the spelling shared by the
OpenAI-compatible providers that implement grammars at all — is the default.

Each backend spells it differently, and each difference was measured:

| backend | grammar | why |
| --- | --- | --- |
| **Fireworks** | default `response_format` | grammar output and `reasoning_effort` are Fireworks extensions to the OpenAI body |
| **llama.cpp** | top-level `grammar` (`gbnfBody`) | `llama-server`'s chat endpoint implements `response_format` only for `json_object`/`json_schema` and **raises** on a type it doesn't know. No `reasoning_effort` — gemma has no thinking channel. It ignores the API key, but `ChatOpenAI` insists on a non-empty one. |
| **OpenRouter** | default, rides through | it has no grammar field of its own: it forwards unknown body params upstream and silently drops the ones that provider doesn't accept, so the default takes effect only where the routed provider understands it — which is why the spec's `body` pins routing to one upstream (see `devdocs/llm.md`) |
| **DigitalOcean** | `null` — none | no grammar reaches the vLLM behind the gateway, whichever spelling is tried: `structured_outputs` (vLLM's current field) comes back "not a supported request field", a grammar `response_format` 400s against vLLM's closed union, and the pre-0.12 `guided_grammar` has no effect. Replies stay on-dialect by system prompt plus the chat loop's `checkSyntax` repair pass. |

Under a grammar the model can satisfy the constraint by looping on whitespace
forever, so a mild `repeatPenalty` is on by default (1 disables it). `repeatLastN`
is left unset so llama.cpp's own default (64) stands.

Adding a provider: one file in `provider/`, one entry in `registry.ts`.

## Warming llama.cpp's KV cache

Only llama.cpp has a local KV slot to prime; a hosted provider has none, and
leaving the warm status at `"pending"` would lock the app's composer forever.

The system prompt is ~21.8k chars and takes **minutes** to evaluate on CPU, during
which no response bytes flow — which trips fetch's (undici) header and body
timeouts. Hence `node:http` with every socket timeout disabled, rather than
`fetch`.

`llama-server` persists the KV itself under `--slot-save-path`, in a file named
after the prompt's content hash: edit the prompt and the old file is simply never
asked for, so a stale cache cannot be restored. gemma also needs `--swa-full`, or
its sliding-window attention discards the prefix KV and there is nothing reusable
to save. The cache file is never `stat`ed — the server is asked to restore it and
allowed to answer, which keeps this working when `llama-server` is not on the same
host.

`ensureWarm` is **single-flight and memoized**: startup kicks it off and the chat
handler awaits the same promise. That gate matters — `llama-server` runs
`--parallel 1`, so a request landing mid-warm would queue ahead of the slot save
and get its own conversation persisted as the "system prompt" cache. It never
rejects: a cold cache is slow, not broken.

Slot files are hundreds of MB each, so stale ones are pruned best-effort — the
directory is a `llama-server` flag and may not be visible from here at all.

`/health` and `/slots` live at the server root; only completions sit under the
base URL's `/v1` path.

## The API's CORS list is load-bearing

One origin, from `APP_URL`, rather than `*`: nothing but the app has any business
driving the agent, and an API that answers every origin is one XSS on any page
away from someone else's browser spending our tokens. `APP_URL` is required with
no wildcard fallback — a deployment that forgets it refuses to boot. It must be a
full origin, scheme included, since an `Origin` header is never a bare hostname.

Custom headers have to be named or the browser refuses to send them, and note
where that failure lands: the preflight still answers 204, the browser compares
what it asked for against the list and gives up **on its own**, so the symptom is
a console error with nothing in the API log at all.

The `x-posthog-*` pair is added by posthog-js `tracing_headers` — both of them,
though only the session id is read — so omitting them breaks the chat itself and
not merely the telemetry riding along with it.

The middleware is mounted on `*`, not `/api/*`, because the app polls `/health`
to know when the KV warmup is done.

## The system prompt is the whole contract

`prompts/lisp.ts` is the only tool description, API reference and protocol spec
the model gets, and `test/prompt.test.ts` pins every rule that had to be learned
the hard way:

- **The text around the forms is skipped, not evaluated**, and prose cannot hold
  a `<` or a `[`. Without these the model falls back on Common Lisp habits it was
  trained on — `;` comments and bare top-level atoms — both of which this dialect
  reads as something else entirely, and every model family brackets a thinking
  channel with `<` or `[`.
- **The REPL prints nothing on its own.** Invisible unless stated: a model that
  is not told waits for values it will never be shown, and keeps retyping data it
  could have referred to by name.
- **Stopping is not failure.** Left to the "don't chat" rule alone the model
  stalls the loop with no-op forms (`(identity "Standing by.")`), burning every
  step up to the cap. The distinction that has to be exact: the user *does* read
  what a step echoes, they just cannot answer mid-loop.
- **The loop is capped**, and the policy interpolates the same `MAX_STEPS` that
  `stream.ts` breaks on.
- **Truncation is a REPL behaviour, not a language feature**, so the closed-world
  rule ("if a name is not listed in the reference, it does not exist") does not
  cover it — the policy has to say it outright or the model reads a `...` line as
  the end of the value.

Every server and tool the prompt's examples name is **invented**. A real one (the
toolkit ships `playwright`, `fs`, `linear`, `posthog`) would hand the model an
answer it is supposed to reach by searching, and would quietly turn the navigate
example into a test of whether it can copy the prompt.
