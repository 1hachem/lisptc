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

The server client is a singleton in `telemetry.ts` built with `flushAt: 20` and
a 5s interval, rather than the `flushAt: 1` PostHog's guides suggest — those are
written for serverless handlers that die after a response, and this API is a
long-lived process where per-event POSTs would be waste. Notes are the
exception and flush immediately.

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
posthog-js, so a note cannot drift into a different project than the trace it
annotates — the browser's posthog-js is a separate client with its own config,
and the two agreeing is a thing you would have to keep true by hand.

## The browser half

`apps/app/src/lib/analytics.tsx` wraps the app in `@posthog/react`'s
`PostHogProvider` from the root route — PostHog's own prescription for TanStack
Start. The provider initialises inside an effect, so nothing runs during SSR,
and it puts the client on context for `usePostHog()` wherever a component wants
to capture something by hand. With no key it is the identity function, the same
no-key-no-op contract the server half has.

It is only product analytics — pageviews, sessions, web vitals, exceptions —
and captures no traces and no notes. It answers the questions the server cannot
see at all: who opened the app and never sent a message, and where they
stopped. `defaults: '2026-05-30'` opts into the current default config, of which
two things matter here: a pageview per history change, since in an SPA a route
change is the only pageview there is, and person profiles for identified users
only.

`before_send` puts `environment` on every event rather than `posthog.register`
doing it, because the provider captures the first pageview during init — before
any effect of ours could run, so a registered property would miss it.

### It talks to us, not to PostHog

Content blockers match analytics by domain, so a browser request to
`posthog.com` is a request that frequently never leaves — which shows up as
traces without the pageviews that led to them, from exactly the technical
audience most likely to be running a blocker. So `api_host` is `/ingest`, a
path on our own origin, and `apps/app/server/routes/ingest/[...path].ts`
forwards it.

The route is a dumb pipe: it strips the prefix, picks an upstream, and relays
method, query string, body and status. Nothing in it understands PostHog's
ingestion API, which is what keeps it from needing changes when that API grows.
Three details are not arbitrary:

- **`/static/*` goes to a different upstream.** PostHog serves the lazily
  loaded bundles — session recorder, toolbar, surveys — from a CDN host rather
  than from the host that accepts events (`POSTHOG_ASSET_HOST`). Everything
  else goes to `POSTHOG_HOST`. With a proxied `api_host` posthog-js stops
  splitting them itself: it can no longer recognise the region, so it sends
  every path to `api_host` and the split has to happen here.
- **`cookie` is stripped on the way out, `set-cookie` on the way back.** Making
  a third party same-origin means the browser now attaches our cookies to every
  event it sends. Forwarding those would hand PostHog whatever session this app
  grows, and relaying its `set-cookie` would let it write first-party ones.
- **`x-forwarded-for` gets the client IP appended, and the user agent is passed
  through.** PostHog derives geo from the first and `$browser`/`$os` from the
  second. Without them every event looks like it came from the server.

`ui_host` is set explicitly for the same reason the asset split exists: a
proxied `api_host` leaves posthog-js unable to work out the region, so every
"view in PostHog" link, the toolbar included, would otherwise point back at the
proxy path.

The path itself is the half a blocklist can still learn. Renaming it means
renaming the route directory and `PROXY_PATH` in `src/lib/analytics.ts`
together.

Note that this is only about the browser. The traces and notes in
`packages/ai/src/telemetry.ts` are sent from the server by `posthog-node` and
were never blockable.

`serverDir: "server"` in `vite.config.ts` is what makes `server/routes/**` a
thing at all — Nitro's filesystem routing is off by default.

## Identity

`x-distinct-id`, a uuid in the browser's `localStorage`, sent as a header on
both chat and note requests. Not an account — it exists so one person's traces
group together, locally today and for real users later, without an auth system
having to exist first. With no id the events set `$process_person_profile:
false` rather than minting a phantom person per thread.

The browser boots with that same uuid, as `bootstrap: { distinctID }`, so a
click and the `$ai_trace` it led to land on one distinct id rather than two. It
is deliberately *not* marked `isIdentifiedID`: this is a per-browser uuid, and
telling PostHog it identifies someone mints a person profile for a person who
does not exist. When there is a real login, `identify(userId)` on login and
`reset()` on logout are what goes in, and `$process_person_profile: false` in
`telemetry.ts` comes back out.

> Note the asymmetry while there is no login: the browser treats the uuid as
> anonymous, but the server still creates a person profile for it whenever
> `x-distinct-id` is present. Making both anonymous is a one-line change in
> `identify()` — left alone because it changes what is already in the project.

### Session replay

posthog-js `tracing_headers` adds `X-POSTHOG-SESSION-ID` to requests to the API
host, `apps/api` reads it, and every event a turn produces carries it as
`$session_id`. That is what lets a trace be *watched* rather than only read: the
replay of the person who typed the prompt, joined to the run it caused.

Two things to know if you touch it. The header name has to be in the Hono
`cors()` `allowHeaders` list (`apps/api/src/app.ts`) or the preflight rejects
every chat request — the failure is the chat breaking, not the telemetry going
quiet. And `tracing_headers` matches on hostname alone: `localhost`, never
`localhost:3001`, since a value with a port in it matches nothing.

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

Two sets, because they are two different kinds of thing. Server variables are
process environment, read at runtime, and never leave the machine. Browser
variables are build input: Vite substitutes them into the bundle and ships them
to everyone. They live in separate Infisical paths so that difference is visible
where the values are stored, not just where they are read.

### `/analytics` — the server, `packages/env/src/analytics.ts`

| variable | default | meaning |
| --- | --- | --- |
| `POSTHOG_API_KEY` | — | unset disables server telemetry entirely |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | where traces are sent, and the browser proxy's upstream; set for EU cloud or self-hosted |
| `POSTHOG_ASSET_HOST` | `https://us-assets.i.posthog.com` | the proxy's upstream for `/static/*` |
| `POSTHOG_ENVIRONMENT` | `local` | an `environment` property on every event, so one project separates local runs from deployed ones |
| `POSTHOG_PRIVACY_MODE` | unset | `true` drops all prompt/completion/REPL content |

### `/web` — the browser, `packages/env/src/web.ts`

| variable | required | meaning |
| --- | --- | --- |
| `VITE_API_URL` | yes | where the app posts chats and notes; also the hostname `tracing_headers` matches |
| `VITE_ENVIRONMENT` | yes | the `environment` property on browser events, so it lines up with `POSTHOG_ENVIRONMENT` on the server's |
| `VITE_POSTHOG_KEY` | no | unset disables browser analytics; the same `phc_` project key, which is publishable by design |

The first two are required, so nothing silently falls back to a default. Note
*when* that fails, though: t3-env validates when the module first runs, not
when the bundle is built, so a build with `/web` missing succeeds and then
serves a 500 on the first render (`❌ Invalid environment variables` in the
server log). Loud, but one step later than you would want. This is also why
`task start:app` runs the build and the serve under a single Infisical
invocation, and why a bare `pnpm dev --filter app`, with no Infisical around it,
throws on the first page.

There is deliberately no `VITE_POSTHOG_HOST`: the browser's host is the proxy
path, and the region is configured once, server-side, where the proxy reads it.

`web.ts` reads `import.meta.env`, so it is validated against the build rather
than against a process, and it is the one module in `@repo/env` that must never
be imported from Node — which is why it is absent from that package's
`index.ts`. It also takes no Vite dependency of its own: adding one pulls a
second copy of Vite into the workspace and breaks the API's plugin types, so
the `import.meta.env` read is a cast with a comment instead.

### Which task gets which path

`task dev-api` and `task start:api` run under `/ai /analytics`. `task dev-app`
and `task start:app` run under `/web /analytics` — `/web` for the bundle, and
`/analytics` as well because the app has a *server* half of its own now: the
proxy resolves `POSTHOG_HOST` and `POSTHOG_ASSET_HOST` per request, at runtime,
in the same process that serves the pages.

Both halves have to be present for the **build**, not only for the process that
serves it, since a `VITE_` value that is missing at build time is missing for
good — `task start:app` runs the build and the serve under one Infisical
invocation for that reason.

## What this is not

PostHog is the analytics half: rates, funnels, dashboards, comparing a prompt
change across a week of real traffic, and knowing that anything happened at all
once other people are using it. It is deliberately *not* the fixture store — a
trace read back out of PostHog is a projection, not something you can replay
deterministically into a test.

When a note is worth turning into a regression test, the observer seam in
[evals](./evals.md) is the recorder that produces a replayable run. The two
share a producer (the agent loop) and nothing else, on purpose.
