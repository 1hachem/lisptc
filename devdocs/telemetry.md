# Agent traces and feedback (PostHog)

Every conversation through `apps/app` is traced to PostHog, and a rating given
on one of its turns lands in the same trace. The point is a short loop: you
notice the agent doing something worth acting on, you say so without leaving the
chat, and the verdict is already joined to the run that produced it.

Set `POSTHOG_API_KEY` and the tracing turns on. Leave it unset and every export
in `packages/ai/src/telemetry.ts` is a no-op — the agent behaves identically.

## The event shape

PostHog's LLM-analytics schema, so a run renders in the trace viewer rather than
as loose custom events:

```
$ai_trace        one per chat turn      the prompt in, the answer out, steps, halted
  $ai_generation   one per model step   tokens, cost, latency, the messages
  $ai_span         one per REPL eval    the Lisp program and what it printed
survey sent      a rating on a turn     joined by $ai_trace_id, sent by the browser
```

The server client is a singleton in `telemetry.ts` built with `flushAt: 20` and
a 5s interval, rather than the `flushAt: 1` PostHog's guides suggest — those are
written for serverless handlers that die after a response, and this API is a
long-lived process where per-event POSTs would be waste.

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
including the votes given on it afterwards. That is the join key for the
trace view and for any insight. `apps/app` now mints the thread id up front
rather than waiting for the server to name one; the API already keyed the
persistent `AgentRepl` off it, so a conversation without one was silently losing
its interpreter state between turns.

### The two numbers worth watching

`steps` and `halted`, both on `$ai_trace`. A turn that burned every step and
never halted is the agent looping — it reads as a success in the transcript
(there is always a plausible final message) and as a failure here.

## Feedback

`▲` / `▼` in the gutter beside every assistant turn
(`components/message-feedback.tsx`), and a one-line input afterwards for the
sentence that explains the vote. This replaced free-text notes, which were the
right instinct and the wrong gesture: a comment is a paragraph nobody writes
twice, while a vote is one keystroke and gives the rating a number to aggregate
on. The sentence is asked for *after* the vote is already recorded, so the cheap
gesture is never blocked on the expensive one.

It goes out as PostHog **survey events**, not an event of our own. That is the
one shape PostHog renders *inside* the trace, so a rating shows up on the run it
is about instead of in a table somewhere else:

```
survey sent  $survey_response: 1|2          the vote — 1 up, 2 down
             $survey_response_1: "…"        the sentence, when there is one
             $survey_submission_id: uuid    ties the two into one response
             $survey_completed: true
             $ai_trace_id: <thread id>      the join key
             message_id, message_index      which turn was voted on
```

Two rules of PostHog's that the code is shaped around. The vote is sent
`$survey_completed: true` on the click rather than held back for a sentence that
may never be typed — a rating waiting on a follow-up is a rating lost when the
tab closes. And a second event under the same submission id has to carry *every*
answer collected so far, so the sentence event repeats `$survey_response`.

The survey itself is created in PostHog and its id passed in as
`VITE_POSTHOG_SURVEY_ID`. Question 0 must be the rating and question 1 the open
text, because that ordering is what `$survey_response` and `$survey_response_1`
mean.

### It is the conversation's trace, not the turn's

`$ai_trace_id` is the thread, so a vote joins the whole conversation rather than
the single turn inside it — `message_id` is what narrows it. Pinning a vote to
its exact turn would mean the server handing its `$ai_span_id` (`turnId` in
`stream.ts`) to the client, which it does not do today.

### Sent from the browser, unlike everything else here

Every other event in this doc is captured server-side. This one cannot be: it is
a survey event, and surveys are a posthog-js feature. So a vote needs the proxy
below to get past a content blocker — and it is the one browser event that still
sends in dev, which is what makes the affordance usable while you work.

## The browser half

`apps/app/src/lib/analytics.tsx` wraps the app in `@posthog/react`'s
`PostHogProvider` from the root route — PostHog's own prescription for TanStack
Start. The provider initialises inside an effect, so nothing runs during SSR,
and it puts the client on context for `usePostHog()` wherever a component wants
to capture something by hand.

Its *ambient* capture is off in dev — no pageviews, no autocapture, no
exceptions, no web vitals. A local session is one person reloading the same
page, and it would land in the same project as the real traffic, distorting
exactly the pageview and bounce numbers this half exists to answer. Agent traces
are unaffected either way: those come from the server, and a local run is worth
tracing, which is what `POSTHOG_ENVIRONMENT` is for.

A vote is the deliberate exception, and is why the client initialises in dev at
all. It is not ambient analytics — it is an annotation on a run, one per click,
and the runs most worth annotating are the local ones you are watching while you
work. `defaults` switches pageviews on, so dev has to countermand it explicitly
rather than leave it unset; `environment` is what separates a local vote from a
real one afterwards.

It is only product analytics — pageviews, sessions, web vitals, exceptions —
and captures no traces of its own. It answers the questions the server cannot
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

Note that this is only about the browser. The traces in
`packages/ai/src/telemetry.ts` are sent from the server by `posthog-node` and
were never blockable — a blocked browser costs you the votes and the pageviews,
not the runs.

`serverDir: "server"` in `vite.config.ts` is what makes `server/routes/**` a
thing at all — Nitro's filesystem routing is off by default.

## Identity

`x-distinct-id`, a uuid in the browser's `localStorage`, sent as a header on
chat requests. Not an account — it exists so one person's traces
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

In dev this is present but thin: posthog-js initialises, so there is a session
id to forward, but with recording disabled there is no replay at the other end
of it.

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

Feedback is never redacted by privacy mode: it comes from the browser rather
than from `telemetry.ts`, and a sentence written to be read later is worse than
useless empty.

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
| `VITE_API_URL` | yes | where the app posts chats; also the hostname `tracing_headers` matches |
| `VITE_ENVIRONMENT` | yes | `dev` \| `staging` \| `prod`. Rides on browser events as `environment`, matching `POSTHOG_ENVIRONMENT` on the server, and `dev` turns off everything the browser captures automatically — votes still send |
| `VITE_POSTHOG_KEY` | yes | the same `phc_` project key, which is publishable by design |
| `VITE_POSTHOG_SURVEY_ID` | yes | the survey the `▲`/`▼` votes are answers to; create it in PostHog with the rating as question 0 and the open text as question 1 |

All three are required, so nothing silently falls back to a default. Note
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

When a downvote is worth turning into a regression test, the observer seam in
[evals](./evals.md) is the recorder that produces a replayable run. The two
share a producer (the agent loop) and nothing else, on purpose.
