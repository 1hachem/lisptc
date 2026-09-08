# The REPL front-ends

`packages/repl`. The interpreter is pure language; a REPL is a driver on top of
it. Three of them: `MemoryRepl`/`AgentRepl` (embeddable, string in / string out),
`cli.ts` (the interactive terminal), and `session-server.ts` (one interpreter
shared over a unix socket).

## `MemoryRepl`

### What lives across a `reset()`, and what dies with the interp

- The **secrets store** is held for the life of the REPL. `freshInterp()`
  re-installs the secrets extension over that same store on every reset, so a
  secret a host pushed in via `repl.secrets.set(...)` survives instead of dying
  with the interp.
- The **`Compactor`** is recreated with every interp. The naming counters must die
  with the globals they named, or a reset leaves the count climbing past unbound
  names. This is deliberately the opposite of the secrets store: one is host
  configuration, the other is per-interpreter state.

The outgoing interp is `dispose()`d first, so an extension holding something the
language cannot reclaim — a live MCP client — releases it rather than leaking
one per reset.

### Construction ordering trap

`this.wordLimit` is assigned **before** `freshInterp()`, which reads it. The
`setup()` hook has the same hazard from the other side: the base constructor
calls it before a subclass's field initializers have run, so an override must
tolerate its own fields still being `undefined`. `AgentRepl.setup` guards
`conversationVars` for exactly this reason.

### Evaluation is async, and serialized

`MemoryRepl.eval` / `evalOutput` return promises, because the interpreter can
now suspend on a promise and the event loop turns *during* an eval. That makes a
second `eval()` reachable while the first is still running, which was
structurally impossible before.

So `evaluate` queues: each call chains onto `inFlight` and runs alone. Without
it, `compactor.beginStep()` / `endStep()` and the channel subscriptions in
`evaluateOne` interleave, and two turns' output lands in each other's report.
The queue survives a failed eval, so one bad step does not strand the ones
behind it.

`reset()` stays synchronous and does not queue: it swaps the interp immediately,
so a host must not reset while an eval is in flight. An eval already running
holds its own interp and its own subscriptions, so it finishes against the
interp it started on.

Nothing may swap the process-wide `setWriter` sink across a suspension point for
the same reason. A host that wants the output of one eval subscribes to that
interp's `user` channel, which is what `evaluateOne` does.

### `evalOutput` is the choke point

`eval` returns the model's copy, so `apps/mcp` inherits the word cap for free,
while `packages/ai` sends the uncapped copy to the UI in
`additional_kwargs.display`.

The two copies arrive as **two channels of this interp**, not as a writer plus a
callback: the compaction extension puts the uncapped copy on `user` and the
capped one on `model` as each form settles, so nothing here has to reassemble
them afterwards. Subscribing to this interp rather than swapping the
process-wide writer also means a second REPL in the same process no longer
captures this one's output.

A `warning` on the model channel is a skip note. A `critical` is *not* taken
here: it is thrown as well as reported, and the surrounding catch is what bounds
it — taking it here too would report it twice, and would make `AgentRepl` read a
failed reply as one that merely skipped something.

An embedded REPL seeds its secrets from `REPL_*` env vars and does **not**
auto-load a `.env` file. That is CLI-only.

## `AgentRepl`

### The finished signal

There is no stop built-in. An agent that has nothing left to run answers in plain
text, and text that runs nothing is a program that does nothing — so such a reply
**is** the end of the loop. `isAnswer` says so when nothing in the reply ran:

- it opened no parenthesis at all — plain prose, the way an agent answers; or
- every parenthesis in it was prose (`all done (see above)`).

**Truncation is excluded.** A reply cut off mid-form also runs nothing, yet it is
an interrupted step, and ending the loop on it would strand the task. Only an
*open* parenthesis says that — an aside the reader could not parse
(``(a deprecated `read_file`)``) is a finished sentence, and asking `checkSyntax`
here would call it a truncation.

The check reads the **unbounded** copy, which is the complete record of what the
program produced; the model's is capped.

It is overridden on `evalOutput` rather than `eval`, so the flag is raised
whichever entry point the driver uses.

### Withheld prose feedback

An answer's skip notes are **not** returned in the output. Handing them back
would make the host feed a result to a model that is done, buying the user an
extra agent turn to be told what the last one already said.

They wait in `pendingProse` for `takeProseFeedback()`, which the host delivers
with the **next** user message — late enough to cost nothing, early enough that
the model does not write the aside again.

A truncated reply is the exception: it is a step to resume, so its note goes
straight back.

### Conversation globals

`setConversationVars` replaces the read-only globals (`conversation`,
`user-messages`, `assistant-messages`) from a fresh host snapshot before every
eval. A `(setq conversation …)` in user code survives only until the next
refresh. They are re-established on every fresh interp so a post-error `reset()`
does not leave the agent blind until the next refresh.

`jsToLisp` is kept separate from the interpreter's `jsonToLisp` so the core stays
free of it. Same mapping: arrays to proper lists, plain objects to alists with
string keys, `null`/`undefined`/`false` to nil (Lisp has only nil for falsity),
`true` to `t`.

## The interactive CLI

**A whole input is buffered before it is evaluated**, rather than read one
expression at a time. Prose is decided over complete text: `run` blanks what is
outside the forms and puts each form to the classifier, and neither can judge a
form still missing its closing paren. That is the attach loop's contract too, so
`pnpm repl` and `pnpm repl:attach` answer identically.

`isComplete` checks `reader.isEmpty()` **before** each read rather than after a
failed one. Once `read()` throws, `readToken()` has already shifted every token
off the reader — including the ones from an unterminated form — so the reader
looks equally empty in both cases if checked afterward. A genuine parse error
counts as "complete enough to send"; the session renders it inline.

Skip notes go to the model's channel, but at an interactive prompt the human *is*
the model's reader, so the CLI shows them. Warnings only — the channel carries
errors too, and those are caught and printed by the eval loop.

The standalone CLI **does** auto-load a `.env`, via `secretsExtension({ envFile })`.
Its secrets store lives for the process and is re-seeded (merge, later wins) on
every reset, so a secret loaded once stays loaded.

A workspace script runs with cwd set to the package dir (`pnpm repl` runs in
`packages/repl`), so a relative script path resolves against the launch dir —
`INIT_CWD` under a package manager, else cwd. Same convention as the `.env`
lookup in the secrets extension, which searches **upward** for exactly this
reason.

## The session server

One long-lived process owns a `MemoryRepl` and serves it to many clients over a
unix socket, so an editor's LSP and a terminal REPL share ONE interpreter. A live
`Interp` is an in-memory object graph and cannot be shared by reference across
processes; exactly one process owns it and every other consumer is a thin client.

Protocol: newline-delimited JSON, `{id, op, code?, symbol?}` /
`{id, ok, result?, error?}`. `completions` and `doc` only **read** the interp
(`globalNames`/`docs`); they never evaluate.

The socket is keyed on the project root (cwd) by default, so everyone in the same
repo shares one interpreter automatically; `LISPTC_SESSION=<name>` splits off a
separate one.

### `PROTOCOL_VERSION` exists for silent staleness

Bump it whenever a change to the request/reply shape means an older server
process could keep answering *successfully* but with data a newer client cannot
rely on — `doc`'s `args`/`arity` fields, which is what it was added alongside. It
lets `connectOrSpawn` notice a server left running from before the bump (across a
`git pull`, say) instead of treating its replies as complete.

A server predating the bump either rejects the (also newly added) `version` op
outright or answers with a stale number. Either way it is replaced.

### Socket-file hygiene

`isListening` distinguishes a **leftover** socket file (server crashed without
cleaning up — safe to delete) from one with a **live listener** behind it (NOT
safe: unlinking it out from under a running server orphans it, since a new bind
at the same path silently steals the name without the old process ever knowing).
`ECONNREFUSED` means nobody is listening; anything else, including a successful
connect, is treated as live.

Losing a spawn race is handled by backing off rather than stealing the name; a
server that finds the path already claimed exits quietly rather than lingering as
an unreachable orphan.

`shutdownAt` always calls `client.destroy()` in a `finally`. `destroy` releases
the socket immediately rather than waiting for a graceful FIN/FIN-ACK, which
matters when the remote might never cooperate — otherwise a server that rejects
the request leaves the handle open and the caller's process hanging forever on a
close that never comes.

The server writes its `shutdown` reply **before** closing and exiting, so a
resolved promise means it genuinely shut down rather than that the connection
happened to drop.

If a stale server cannot be stopped (it predates `shutdown` too), the client
hands back a fresh connection to it rather than getting stuck retrying a spawn
that can only ever lose the bind race.

### `SPAWN_TIMEOUT_MS` is 20s on purpose

The child is a cold `node --experimental-transform-types` start that has to
type-strip the whole interpreter before it ever calls `listen` — comfortably
under a second idle, but several times that on a loaded machine (a CI runner
building every workspace at once), where a tighter budget gave up on a server
that was merely slow to boot.
