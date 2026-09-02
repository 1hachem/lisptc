# Agent traces and notes (PostHog)

Every conversation through `apps/app` is traced to PostHog, and a note written
about that conversation lands in the same trace. The point is a short loop: you
notice the agent doing something worth acting on, you write it down without
leaving the chat, and the note is already joined to the run that produced it.

Set `POSTHOG_API_KEY` and it turns on. Leave it unset and every export in
`packages/ai/src/telemetry.ts` is a no-op — the agent behaves identically, and
the app says `note dropped` instead of pretending a note landed.

## The event shape

PostHog's LLM-analytics schema, so a run renders in the trace viewer rather than
as loose custom events:

```
$ai_trace        one per chat turn      the prompt in, the answer out, steps, halted
  $ai_generation   one per model step   tokens, cost, latency, the messages
  $ai_span         one per REPL eval    the Lisp program and what it printed
$ai_note         a comment, joined by $ai_trace_id
```

`$ai_generation` is emitted by `@posthog/ai`'s `LangChainCallbackHandler`, wired
in `agent.ts`. It reports token counts and cost correctly per provider, which is
not worth hand-rolling. `$ai_parent_id` has to be forced onto the handler's
properties because the chat model is called directly rather than through a
chain, so LangChain has no parent run of its own to report.

`$ai_span` is emitted by hand from `stream.ts`, once per REPL evaluation. This
is the half LangChain cannot see and the half that matters here: the model's
output *is* a Lisp program, so the interesting failure is what that program did,
not what the completion looked like.

### `$ai_trace_id` is the chat's `thread_id`

Everything a conversation ever produced shares one id — across turns, and
including the notes written about it afterwards. That is the join key for the
trace view and for any insight. `apps/app` now mints the thread id up front
rather than waiting for the server to name one; the API already keyed the
persistent `AgentRepl` off it, so a conversation without one was silently losing
its interpreter state between turns.

### The two numbers worth watching

`steps` and `halted`, both on `$ai_trace`. A turn that burned every step and
never halted is the agent looping — it reads as a success in the transcript
(there is always a plausible final message) and as a failure here.

## Notes

Two ways in, both writing the same `$ai_note` event:

- **`/note <text>`** in the composer — a comment about the conversation. It is
  intercepted client-side in `chat.tsx` and never reaches the model: the thing
  being measured must not change because it was measured.
- **`+ note`** under any message — a comment about that turn. Carries the
  message id, its index, and an excerpt, so the note reads on its own in PostHog
  without opening the trace.

`#tags` anywhere in the text become a `tags` property. Tags are the cheap
version of "link this to the other conversations where the same thing happened":
one note on one thread finds the rest by a property filter. Typing a tag inline
is the only version of that gesture anyone actually performs.

Notes are captured server-side (`apps/api/src/note.ts`) rather than from
posthog-js, so the project key stays on the server and a note cannot drift into
a different project than the trace it annotates.

## Identity

`x-distinct-id`, a uuid in the browser's `localStorage`, sent as a header on
both chat and note requests. Not an account — it exists so one person's traces
group together, locally today and for real users later, without an auth system
having to exist first. With no id the events set `$process_person_profile:
false` rather than minting a phantom person per thread.

## Privacy

`POSTHOG_PRIVACY_MODE=true` keeps the metrics — latency, tokens, error rates,
step counts, `halted` — and drops every prompt, completion and REPL payload.

Lisp `Secret` values already print as `#<secret:KEY>` (see
[secrets](./secrets.md)), so REPL output is redacted at the source. What that
does *not* cover is an MCP tool result carrying user data, which is not a secret
and otherwise lands in `$ai_output_state` verbatim. Turn privacy mode on before
pointing this at anyone's data but your own.

Notes are always captured in full, privacy mode or not: a note is written to be
read later, and an empty one is worse than none.

## Configuration

| variable | default | meaning |
| --- | --- | --- |
| `POSTHOG_API_KEY` | — | unset disables telemetry entirely |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` | set for US cloud or self-hosted |
| `POSTHOG_ENVIRONMENT` | `local` | an `environment` property on every event, so one project separates local runs from deployed ones |
| `POSTHOG_PRIVACY_MODE` | unset | `true` drops all prompt/completion/REPL content |

Validated in `packages/env/src/analytics.ts`. Injected the same way the provider
keys are — Infisical, via `task dev-api`.

## What this is not

PostHog is the analytics half: rates, funnels, dashboards, comparing a prompt
change across a week of real traffic, and knowing that anything happened at all
once other people are using it. It is deliberately *not* the fixture store — a
trace read back out of PostHog is a projection, not something you can replay
deterministically into a test.

When a note is worth turning into a regression test, the observer seam in
[evals](./evals.md) is the recorder that produces a replayable run. The two
share a producer (the agent loop) and nothing else, on purpose.
