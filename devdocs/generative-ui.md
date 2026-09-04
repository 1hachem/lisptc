# Generative UI

Compression's bargain is that the REPL *describes* a value instead of printing
it, and `echo` is the one way anything reaches the screen. This is the other
half: a way to put a value on the screen as an **interactive thing** rather than
as text.

`(ui/render view)` publishes a widget tree. The tree may carry Lisp callables —
a button's action, a form's submit handler, a select's `:on-change` — which never
leave the interpreter: each is registered under an opaque id (`a1`, `a2`, …) and
only the id is serialised. When the user clicks, the host calls back with that
id, the closure runs in the *same* interpreter with all its state intact, and
whatever it renders becomes the new view.

So the loop is: the model writes Lisp that BUILDS a UI, the user drives that UI,
and driving it runs more Lisp — without another model turn. That is the whole
economic argument. An interaction the model anticipated when it wrote the view
costs one REPL evaluation and **zero tokens**, and it leaves no mark on the
transcript, so it cannot confuse a later turn with state the model never saw
change. A step that renders is told only `rendered stack, 8 elements, 3 actions`:
describing the widget back to the model would spend exactly the context that
drawing it saved.

## The pieces

- `packages/interpreter/src/ui.ts` — the extension. `UiElement` (an opaque Lisp
  value, not an alist the agent could half-edit into an invalid shape), the
  `ui/*` constructors, and `UiSurface`: the live handler map plus the rendered
  view and the outbox for `ui/send`.
- `packages/repl/src/repl.ts` — creates one `UiSurface` **per interpreter** and
  exposes `invokeUi(action, values)`. Per-interpreter because a handler closes
  over that interpreter's environment, so it must die with it — the same rule as
  `Compressor`, the opposite of `secretsExtension`'s host-held store. `reset()`
  drops every action.
- `packages/ai/src/ui-action.ts` — runs one click in the thread's live
  `AgentRepl`. Deliberately does not touch the transcript.
- `apps/api/src/ui-action.ts` — `POST /api/ui-action`. A thread with no live REPL
  answers `409`: the widget is still on screen but nothing behind it exists,
  which is a gone session rather than a failed click.
- `apps/app/src/components/generative-ui.tsx` — draws the tree and fires
  handlers. A view arrives on a step's tool message as `additional_kwargs.ui`.

## Why handler ids and not code

The frontend never receives anything executable. It receives `"action": "a1"`,
which means nothing to anyone who does not hold that interpreter. That is what
makes the feature safe to hand a browser: the closure is a capability the server
keeps, the id is a bearer token for one specific anticipated interaction, and the
handler map is bounded (`MAX_HANDLERS`, 500, oldest first) so clicking a button
in a very old view reports a dead action rather than silently doing nothing.

## The widget set

| Constructor | Draws |
| --- | --- |
| `ui/text` `ui/heading` `ui/markdown` | prose |
| `ui/stack` `ui/row` `ui/card` | layout; `ui/card` is titled |
| `ui/kpi` | one number, big, with an optional hint |
| `ui/badge` | a short status label, `:tone` ∈ `ok warn bad info muted` |
| `ui/link` | a link, opened in a new tab — the one widget with no handler |
| `ui/table` | a list of alists, at most `MAX_ROWS` (200) of them |
| `ui/input` `ui/select` `ui/checkbox` | fields |
| `ui/button` `ui/form` | the things that act |

`ui/badge`'s tone is a **closed set validated in the interpreter**, because the
frontend maps each tone to one colour: an unknown tone would draw as no colour at
all, and a badge that silently lost its meaning is worse than an error at the
call site.

## Three ways a widget acts

1. **A click or a submit.** `ui/button`'s action, `ui/form`'s handler. The
   handler renders, and the new tree replaces the old one in place.
2. **`:on-change`** on `ui/select` or `ui/checkbox` — the handler runs the moment
   the user picks or ticks, with no submit button. This is the cheap version of a
   reactive filter: it reuses the click transport exactly, so it cost one
   `surface.action()` call and one `onChange` in the renderer, with no dataflow
   graph anywhere.

   Text fields get no `:on-change` **on purpose**. Every keystroke would be a
   round trip that replaces the tree, which remounts and so unfocuses the very
   field being typed into. A `ui/input` belongs in a `ui/form`, where the submit
   carries it.
3. **`(ui/send text…)`** — the escape hatch. A handler that hits something it
   cannot answer alone (the user typed a request rather than a filter; the choice
   needs judgement) puts a message in the conversation as a *user* turn and the
   agent takes it from there. The actions are the cheap path; `ui/send` is the
   expensive one, chosen by the handler at click time rather than by the model in
   advance. Several sends in one handler join into one message, because one click
   is one thing the user did, and the text is capped (`MAX_MESSAGE_CHARS`, 4000):
   a sent message becomes a user turn, so it stays in the model's context for the
   rest of the conversation — the one place in the feature where a runaway
   handler would keep costing.

## What a field is worth

Field values arrive as strings, with one exception that matters. A `ui/checkbox`
sends a real **boolean**, which `jsonToLisp` maps to `t`/`nil`, so a handler can
write `(if (cdr (assoc "open" values)) …)`.

It has to work this way. In Lisp only `nil` is false, so `""` and the string
`"false"` are **both true** — a string-valued tick box could not be tested at
all, and the bug would be silent. The frontend therefore walks the form's
checkboxes explicitly after reading `FormData`, which omits an unticked box
entirely rather than reporting it false.

`:checked` is read with Lisp truthiness (`:checked t`), and is absent from the
props when not given, so the frontend can tell "no default" from "off".

## Deferred

These came out of a comparison with [OpenUI Lang
v0.5](https://www.openui.com/docs/openui-lang/specification-v05), a declarative
DSL for the same problem: an LLM emits a spec and a runtime owns the
interactivity. Most of that spec is not applicable here — it re-implements
operators, member access, ternaries, `@Sum`/`@Filter`/`@Sort`, and `@Each`
because its host is not a language, and we get all of it from Lisp. `@ToAssistant`
is `ui/send`, arrived at independently, which is some evidence that the escape
hatch is the load-bearing idea. Its `Action([@Run(m), @Run(q), @Reset($t)])` step
list, fail-fast, is `progn` plus exception propagation.

Four things in it are genuinely absent here.

**Charts.** The highest-value missing widget: an agent summarising metrics has a
table or prose and nothing else. Deferred because there is no chart library
anywhere in the repo, so it means either a new dependency or hand-rolled SVG,
plus a column-oriented prop shape (`:x`/`:y` lists) that nothing else needs.
Note the *data* side is already expressible — OpenUI needs `data.rows.title`
column-pluck syntax where we have `(mapcar (lambda (r) (cdr (assoc "title" r))) rows)`.

**Queries: data that refreshes itself.** OpenUI's `Query("tool", {arg: $var},
{rows: []}, 30)` auto-runs on load, re-runs when a referenced variable changes,
polls on an interval, and renders the third argument *before* data arrives. Two
parts are worth taking. The defaults argument is purely ergonomic and cheap: it
exists so the pre-data render is valid, which removes the null-guard branch the
model would otherwise write into every generated view. The refreshing half is
the expensive part, but it fits the runtime we already have — a `ui/query` could
start a job on `JobsRuntime` and let the existing `onSettled` push a re-render,
which is the same mechanism that makes MCP effects appear between evals. The open
question is not how, but what a poll interval *means* for a thread that can be
evicted from the `AgentRepl` LRU at any time.

Their `Query`/`Mutation` split — reads run on load, writes only when an action
fires them — is a real safety property that we would get by convention rather
than by construction, and it belongs in the prompt if queries ever land.

**Full reactive state.** `$days = "7"` declared once, two-way bound into a
`Select`, with every expression referencing it re-evaluating on change.
`:on-change` buys most of the benefit for a fraction of the cost, because a
handler closing over the session can just `setq` and re-render. What it does not
buy is *partial* re-render: today a handler redraws the whole view, and with a
big table that is a visible flash. A real binding layer would need per-node
identity, which the tree does not have — the server rebuilds it whole on every
render and the frontend keys children by position.

**A host-registered widget vocabulary.** OpenUI generates its system prompt from
the component library's Zod schemas, so the prompt and the renderer cannot drift.
Here a widget is spelled out in three places that must agree by hand: the
`interp.def` in `ui.ts`, the `case` in the renderer's switch, and the
enumeration in `packages/ai/src/prompts/lisp.ts` (pinned by
`packages/ai/test/prompt.test.ts`, which is what actually catches the drift).
Add a tag to the extension and forget the renderer and the widget draws as
`unknown widget: …`. A `uiExtension({ widgets })` taking a host-supplied
registry would close that, and would fit how `secretsExtension` already takes a
host-supplied store. Not worth it at ten widgets; worth it before twenty.
