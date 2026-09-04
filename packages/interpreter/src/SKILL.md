# Lisptc Language Reference

Lisptc is a Common-Lisp-like dialect: cons cells, symbols, lexical scoping,
macros, tail-call optimization, and a small standard library (the "prelude").
This document is authoritative — the syntax, every built-in, the REPL contract,
and the interactive views. If a name is not listed here, it does not exist, so
define it yourself.

## 1. Syntax

Source is s-expressions. `(f a b)` calls `f` with the evaluated `a` and `b`.

Only the parenthesised top-level forms are program text: anything written around
them is prose and is ignored, so a program can be prose with forms embedded in it
(`Let me square it: (sq 5)` evaluates just `(sq 5)`). Three consequences: a bare
value at top level (`42`, `"done"`, `my-var`) is prose, not an expression to
evaluate — wrap it in a form; a stray parenthesis in prose is still read as code,
so never write one (no `:)`, no `(see below)`); and prose cannot hold a `<` or a
`[` at all — write "less than", or put the comparison in a form, `(< 1 2)`.

- **Quote**: `'x` = `(quote x)` — returns `x` unevaluated.
- **Quasiquote**: `` `x `` = `(quasiquote x)`. Inside it `,x` (`unquote`) inserts
  the evaluated `x` and `,@x` (`unquote-splicing`) splices a list:
  `` `(a ,(+ 1 2) ,@(list 3 4)) `` → `(a 3 3 4)`.
- **Lists**: `(a b c)`. Dotted pair: `(a . b)` is a single cons cell.
- **Strings**: `"..."` with escapes `\\ \" \n \r \f \b \t \v`. There is no
  character type — a "character" is a one-character string.
- **Keywords**: `:foo` is self-evaluating and interned, so `(eq :a :a)` is `t`.
- **Comments**: there is no comment syntax — the prose around the forms is the
  comment. `;` is an ordinary symbol character, so `; note` inside a form is read
  as code and errors.
- **Symbols**: any token that is not a number/string/keyword/`nil`/`t`. `/` and
  `-` are legal in names (`string-split`, `acme/get_widget`).

## 2. Data types

`nil` = `()` = the empty list = the ONLY false value · `t` = canonical true ·
cons cell, a pair `(car . cdr)` chained into lists ending in `nil` · symbol, an
interned name (`gensym`/`make-symbol` make uninterned ones, printed `#:name`) ·
keyword · string · number, an exact bigint or an inexact float (§4) ·
function/closure/macro · Secret, a tainted string (§10.3).

Everything except `nil` is truthy, INCLUDING `0`, `0.0`, `""` and empty
structures — test emptiness with `null`/`not`, never by relying on falsiness.

## 3. Special forms

Evaluated specially, not as ordinary calls. This is the complete list:

| Form | Meaning |
|------|---------|
| `(quote x)` | Return `x` unevaluated (`'x`). |
| `(progn e...)` | Evaluate in order, return the last. |
| `(cond (test body...) ...)` | First clause with non-nil `test`: eval its body, return last (or the test value if no body). Else `nil`. |
| `(setq name val ...)` | Assign, one or more pairs; returns the last value. Defines/updates a global if `name` isn't a local. |
| `(lambda (args...) body...)` | Anonymous function, a closure over the current scope. |
| `(macro (args...) body...)` | Anonymous macro, top level only; normally use `defmacro`. |
| `` `x `` | Quasiquote template with `,`/`,@` (§1). |
| `(try body (catch (e) handler...))` | Eval `body`; on error bind `e` and run the handler (§8). |

Everything else that looks like a form — `if when unless and or let let* letrec
while dolist dotimes case defun defmacro` — is a **prelude macro** (§6), used the
same way. There is no `setf`, `block`/`return-from`, `unwind-protect`, or
`throw`/`catch` pair.

Tail calls are optimized: deep recursion in tail position and the loop macros do
not overflow the stack.

## 4. Numbers

Integer literals are exact bigints (`42`); anything with a decimal or exponent is
an inexact float (`42.0`, `4.2e1`).

- `+ - *` keep exactness, but mixing in ANY float makes the whole result a float:
  `(+ 1 2)` → `3`, `(+ 1 2.0)` → `3.0`.
- **`/` is ALWAYS a float**, even when it divides evenly: `(/ 6 2)` → `3.0`. For
  exact integer division use `truncate` (returns a bigint): `(truncate 6 2)` → `3`.
- Output disambiguates: an integer-valued float prints `3.0`, a bigint prints `3`.
- `=`/`eql` compare numerically across types: `(= 3 3.0)` → `t`.
- `/` by zero follows JS (`Infinity`, `NaN`, no error), but `truncate`/`%`/`mod`
  on bigints throw. Guard divisors.

`(+ n...)` sum, 0 if none · `(* n...)` product, 1 if none · `(- n m...)` subtract,
or negate one arg · `(/ n m...)` float divide · `(% x y)` remainder with the sign
of `x`, alias `rem` · `(mod x y)` modulo with the sign of `y` · `(truncate x [y])`
toward zero → bigint · `(< x y)` primitive, with `>`, `>=`, `<=`, `/=` and `=`
added by the prelude.

`(numberp x)` is the only numeric predicate. There are NO `zerop`, `evenp`, `abs`,
`min`, `max`, `floor`, `ceiling`, `round`, `expt`, `sqrt`, `gcd`, etc. — build
them yourself (even: `(= 0 (% n 2))`; abs: `(if (< n 0) (- n) n)`).

## 5. Primitive built-ins

**Lists & pairs** — `(car x)` · `(cdr x)` · `(cons a b)` · `(list x...)` ·
`(length x)` of a list or string → bigint · `(rplaca cell x)` / `(rplacd cell x)`
destructive set (aliases `setcar`/`setcdr`).

**Predicates** — `(atom x)` true if not a cons · `(eq x y)` identity ·
`(eql x y)` identity or numeric/string equality (alias `=`) · `(stringp x)` ·
`(numberp x)`.

**Symbols** — `(gensym)` · `(make-symbol name)` · `(intern name)` ·
`(symbol-name sym)`.

**Strings** (taint-aware, §10.3) — `(char s i)` the one-character string at `i`,
or `nil` · `(concat s...)` strings only · `(string-upcase s)` ·
`(string-downcase s)` · `(string x)` convert any value to its printed form, with
a string left as itself rather than quoted: `(string 12)` → `"12"`, `(string nil)`
→ `"nil"`. That is how a number goes into text: `(concat "Chapter " (string n))`.
A float keeps its `.0`, so `(string (truncate x))` gives a bare integer.

**Parsing text into data** — two different parsers, not aliases.
- `(read s)` parses the FIRST *Lisp* expression in `s` and returns it as data,
  unevaluated: `(read "(+ 1 2)")` → the list `(+ 1 2)`, not `3`. Trailing text is
  ignored; a string with no expression errors.
- `(json-parse s)` parses a *JSON* document: object → alist with string keys,
  array → list, `true` → `t`, `false`/`null` → `nil`. Every number arrives as a
  float (`7` reads back as `7.0`; `=` still compares it equal to `7`). Read a
  field with `(cdr (assoc "title" (json-parse s)))`.
- `read` on JSON does not error, it returns junk (`{` is an ordinary symbol
  character, so `{"a": 1}` reads as the symbol `{`).

**Eval & control** — `(apply f args)` call `f` with the elements of `args` ·
`(error value)` raise a catchable error carrying any value (§8) · `(break)` exit
the nearest loop · `(return value)` exit it with a value.

**Output** — `echo` is the ONLY thing that prints; there is no `print`, `princ`,
`terpri` or `view`, and the REPL prints nothing on its own (§9).
- `(echo x...)` print the arguments space-separated with one trailing newline:
  strings as they are, everything else re-readable. `(echo)` is a blank line.
- `(echo x :offset 0 :length n)` print a window of `x` counted in
  whitespace-separated words; the `...` line it ends with gives the offset to
  continue from.
- `(echo x :match "re" :context 8 :max 10 :ignore-case t)` print only the regions
  matching a regular expression, each as `@<word-offset>` plus the surrounding
  words with the match in `[[ ]]`. Feed a reported offset back in as `:offset`.

**Extracting** — `head`/`tail`/`grep` RETURN a value, which the REPL then names
(§9), instead of printing it. Use `echo :match` to READ a region, `grep` to KEEP
what matched.
- `(head x [n])` the first `n`, `(tail x [n])` the last `n`. On a list that is `n`
  ELEMENTS — `(head issues 4)` is the first four rows; on text it is `n` words.
- `(grep x "pattern" :group n :max n :ignore-case t)` what `pattern` matched, as a
  list, or `nil`. On a list, the ELEMENTS whose printed form matches
  (`(grep issues "auth")` is the issues about auth); on text, the matched
  substrings (`(grep page "https?://[^ ]+")` is the URLs in it).

**Introspection** — `(doc name)` print a binding's signature and doc, `(doc)` list
all documented names · `(dump)` every global symbol · `(import "path")` load and
eval a Lisp file. Globals: `*gensym-counter*`, `*version*`.

## 6. Prelude standard library

**List access** — composed car/cdr: `caar cadr cdar cddr caaar caadr cadar caddr
cdaar cdadr cddar cdddr` (`cadr` = 2nd element, `caddr` = 3rd).

**Lists** — `(append list...)` non-destructive concat · `(nreverse list)` ·
`(last list)` last cons cell · `(nconc lists...)` destructive concat ·
`(mapcar f list)` — `(mapcar (lambda (n) (* n n)) '(1 2 3))` → `(1 4 9)` ·
`(nth n list)` element at index `n` from 0, `nil` past the end. There is no
`mapc`, `reduce`, `filter`, `remove`, `elt` or `sort` — build them with recursion,
`mapcar` or `dolist`.

**Predicates** — `(not x)` / `(null x)` · `(consp x)` · `(listp x)` nil or cons ·
`(equal x y)` deep structural equality.

**Membership & alists** — `(memq key list)` / `(member key list)` tail from the
first `eq` / `equal` match · `(assq key alist)` / `(assoc key alist)` first pair
with an `eq` / `equal` car. Read a field: `(cdr (assoc "content" msg))`.

**Control-flow macros** — `(if test then else...)` · `(when test body...)` ·
`(unless test body...)` · `(and x...)` nil on the first nil, else the last ·
`(or x...)` the first non-nil · `(case key (keys forms...) ... (t default...))`
matching by `equal`, with `t` as the default clause.

**Binding macros** — `(let ((name val)...) body...)` parallel, a bare `name` binds
`nil` · `(let* ...)` sequential, each `val` may use the names before it ·
`(letrec ...)` bindings may reference each other, for local recursive functions.

**Loops** (all support `(break)` and `(return value)`) — `(while test body...)` ·
`(dolist (name list [result]) body...)` · `(dotimes (name count [result]) body...)`.

**Defining** — `(defun name (args...) [doc] body...)`, `&rest x` for variadic ·
`(defmacro name (args...) [doc] body...)`.

**Strings** (taint flows through all of these) — `(substring s start [end])` ·
`(string-prefix? p s)` · `(string-suffix? p s)` · `(string-index s sub [start])` →
index or `nil` · `(string-contains? s sub)` · `(string-count s sub)` ·
`(string-replace s old new)` · `(string-split s sep)`, empty `sep` → characters ·
`(string-join list sep)` · `(string-trim s)`.

**Misc** — `(identity x)` · `(think part...)` echo reasoning as narration: parts
print literally but a `,x` part is evaluated first, e.g.
`(think "sum is" ,(+ 1 2))`. It returns `nil`, so put the real answer in a
separate expression.

## 7. Macros

`defmacro` defines a compile-time transformer; build the expansion with
quasiquote. Use `(gensym)` for temporaries you introduce, so they cannot capture
a user variable. Macros expand up to 20 nesting levels.

```
(defmacro swap (a b)
  `(let ((tmp ,a)) (setq ,a ,b) (setq ,b tmp)))
```

## 8. Errors

`(error value)` raises; `value` can be any Lisp value, often a string.
`(try expr (catch (e) handler...))` evaluates `expr` and, if it raises, binds `e`
to the raised value and runs the handler. This is the ONLY error mechanism —
there is no condition system and no `unwind-protect`.

```
(try (/ 1 0) (catch (e) (concat "failed: " e)))
```

`(break)` / `(return value)` escape the nearest `while`/`dolist`/`dotimes`; using
them outside a loop is an error.

## 9. The REPL loop

The session is persistent: definitions from earlier steps stay available, so build
on them. You act one step at a time — emit a form, read its result, decide the
next. Three read-only globals mirror the conversation and refresh every step:

- `conversation` — list of messages, each an alist with `"role"` and `"content"`.
  Read a field: `(cdr (assoc "content" (car conversation)))`.
- `user-messages` — the user's message strings.
- `assistant-messages` — your prior message strings.

Re-assigning them does not persist; copy into your own variable to keep a value.

### The REPL is silent: it reports a result's name and shape

The REPL prints nothing on its own. Every result is bound to a variable — named
after the function that produced it — and reported as one line, `name: shape`,
saying what is in it:

```
(acme/list-issues :query "auth bug")
acme/list-issues-1: list of 27 alists, keys "id" "identifier" "title" "state" "url"

(+ 1 2)
+-1: 3
```

A small value is reported as itself; a large one is described (`list of 27
alists, keys ...`, `3412 words`, `200 characters`). Either way **the variable
holds the whole value.** A `setq` or `defun` is reported under the name it already
bound, and `nil`/`t` report plainly — there is nothing to name.

**NEVER retype data the REPL produced.** The name is the only handle on that
result: it holds the exact value, costs a handful of tokens, and cannot be
misremembered. Re-emitting a list, an id, a title or a body by hand is wasted
output and the main way you produce wrong data. Never invent a name either — the
REPL always tells you the one it bound. Build on it:
`(mapcar (lambda (i) (cdr (assoc "id" i))) acme/list-issues-1)`.

### EXTRACT, THEN ECHO

The shape line tells you what to write next. Two moves cover almost everything:
`head`/`tail`/`grep` to pull out a value, which the REPL names, and `echo` to show
a rendering of it. `(echo x...)` is the ONE command that prints, and the only way
either you or the user sees a value.

```
(grep page-1 "https?://[^ ]+")
grep-1: ("https://x.dev/a")

(echo (car grep-1))
https://x.dev/a
```

```
(head acme/list-issues-1 4)
head-1: list of 4 alists, keys "id" "identifier" "title" "state" "url"

(defun row (i) (concat "| " (cdr (assoc "identifier" i)) " | " (cdr (assoc "title" i)) " |"))
row: function

(echo (string-join (mapcar row head-1) "\n"))
| ENG-12 | Auth token refresh fails |
| ENG-31 | OAuth callback drops the state param |
```

Both wrong versions look like this — never read a value off a printout and retype
it:

```
(echo "https://x.dev/a")                         the URL typed from a printout
(echo "| ENG-12 | Auth token refresh fails |")   the rows typed out by hand
```

You cannot retype what you were never shown, which is why the REPL describes a
result instead of printing it. Prefer computing over reading: `(length x)`,
`mapcar`, `assoc` and `grep` work on the complete value, and one form that
extracts what you need beats paging through text.

### Echo output is capped for you, not for the user

A step may echo a fixed number of words, shared across all its echoes. Past that
your copy of the text stops and a `...` line says how much is left and how to
continue:

```
(echo range-1)
(39 38 37 36 35 34
... 6 of 40 words shown, 34 below — read on with (echo range-1 :offset 6)
```

The user reading the conversation sees the whole output; the cap is on your copy
alone. So when you see that line, do not re-run the call and do not answer from
the fragment: page on with the offset it gave you, or narrow it with
`(echo range-1 :match "pattern")`. Output that is one unbroken word (minified
JSON, say) is cut by character instead, and the `...` line points at `substring`.

## 10. MCP tools, async jobs, secrets

### 10.1 MCP servers

You are not told which servers exist or what they are called. `(search-mcps
"query")` and `(list-toolkit)` find one to load; `(search-tools "query")` and
`(list-tools "server")` find its tools once it is loaded. Never invent a server or
tool name — read it out of one of those results.

- `(load-mcp "name")` loads a predefined server. It is **asynchronous**: it returns
  a job immediately and does NOT block; the tools install only when the job settles.
- **To load and use in one step, wrap the SINGLE `load-mcp` call in `await`:**
  `(await (load-mcp "acme"))` blocks until ready and returns the tool list. Do NOT
  call `(load-mcp "acme")` and then `(await (load-mcp "acme"))` — that starts TWO
  connections. Either wrap it directly, or bind the one job and await that.
- Load several concurrently: `(await-all (list (load-mcp "a") (load-mcp "b")))`.
- Ad-hoc servers, all awaited the same way:
  - Remote: `(load-mcp :name "x" :url "https://..." :headers '(("Authorization" . "Bearer ...")))`
  - Local stdio: `(load-mcp :name "acme" :command "npx" :args '("-y" "acme-mcp-server"))`
  - OAuth remote: add `:oauth t` and optional `:scopes`, then use `login`/`mcp-authorize`.
- `search-mcps` searches the *toolkit* of predefined servers, loaded or not;
  `search-tools` searches the tools of *already-loaded* servers by name and
  description, ranked best-first. It takes ONE query string and searches ALL loaded
  servers — there is no server argument, so `(search-tools "acme" "widget")` is an
  arity error. To search one server's tools, load it first; to list them use
  `(list-tools "acme")`. `(list-mcps)` lists what is loaded.
- `(unload-mcp "name")`, `(mcp-shutdown)`.
- OAuth lifecycle, for `:oauth t` servers only: `(login "name")` begins
  authorization and returns the login URL to open, or `:logged-in` if already
  authenticated; after approving, `load-mcp` connects. `(mcp-authorize "name"
  "code")` completes a code flow. `(logout "name")` → `:logged-out` unloads the
  server and deletes its saved tokens, so the next load re-authorizes from
  scratch — use it to sign out, or to force fresh consent after widening
  `:scopes` (a tool call returning `403 insufficient_scope`). Both take a
  predefined OAuth server name and error on anything else; `logout` is safe when
  the server is not loaded.
- Each loaded tool becomes a global named `<server>/<tool>`, called with keyword
  args and **blocking** — it returns the result directly, e.g.
  `(acme/get_widget :id "42")`. Inspect one with `(doc 'acme/get_widget)`.
- A tool result arrives already converted to Lisp data (JSON object → alist with
  string keys, array → list), so read it with `assoc`/`cdr`/`mapcar`/`nth` — no
  parsing step. Only when a tool hands back a *string* that happens to contain
  JSON do you need `(json-parse s)` (§5).
- Full example. The server and tool names here are made up: you never know them in
  advance, so start from `search-mcps` and let each step tell you the next name.
  ```
  (search-mcps "widget")
  (await (load-mcp "acme"))
  (search-tools "widget")
  (acme/get_widget :id "42")
  ```

### 10.2 Async jobs

A *job* is a handle for background work (currently just `load-mcp`).
`(await job [timeout-ms])` blocks for the result and re-raises the job's error ·
`(await-all jobs [ms])` results in order, a failed one as `(:error "msg")` ·
`(await-any jobs [ms])` the first result · `(job-status job)` checks progress
(:pending/:done/:error) without blocking · `(jobs)` lists in-flight jobs ·
`(cancel job)` aborts one.

### 10.3 Secrets

`(secrets)` → an alist of `(key . description)` with the values hidden.
`(secret "REPL_TOKEN")` → the value as a **tainted string**: it behaves like a
string in every string function and the taint propagates through the result, but
it prints redacted as `#<secret:KEY>` and is revealed only when serialized into an
outgoing MCP argument or header. Only `REPL_`-prefixed keys are visible. Example:
`(load-mcp :name "acme" :url "..." :headers (list (cons "Authorization" (secret "REPL_ACME_TOKEN"))))`.

## 11. Interactive views (`ui/*`)

`echo` puts text on the user's screen. `ui/render` puts a **widget** there — one
they can click, type into and submit, with each interaction running Lisp in this
same REPL.

```
(defun panel ()
  (ui/stack
    (ui/heading "Open issues")
    (ui/table (head issues-1 10))
    (ui/form (lambda (values) (ui/render (results (cdr (assoc "q" values)))))
      (ui/input :name "q" :label "filter" :placeholder "auth")
      :submit "search")))
(ui/render (panel))
```

**Constructors** — each returns a widget; none of them draws anything on its own.
- `(ui/text s)` a line · `(ui/heading s)` · `(ui/markdown s)` a block of markdown.
- `(ui/stack child...)` one above the next · `(ui/row child...)` side by side. A
  bare string child becomes `ui/text`.
- `(ui/card title child...)` a titled box. Break a long view into named parts;
  with no cards a big `ui/stack` reads as one wall of things.
- `(ui/kpi label value [:hint "..."])` one number, big — `(ui/kpi "open" 27)`. The
  most understanding per token of anything here: it says at a glance what a 27-row
  table says in a screenful. `:hint` is a smaller line under it.
- `(ui/badge text [:tone "ok"])` a short status label, `:tone` one of `ok` `warn`
  `bad` `info` `muted`. For the *state* of a thing — a status, a severity, a
  check's result — where a sentence would be noise.
- `(ui/link text url)` a link opened in a new tab. Use it for a URL a tool handed
  you, so the user can follow it instead of copying it out of a table.
- `(ui/table rows [:columns '("id" "title")])` — `rows` is a list of alists, the
  shape an MCP tool result usually has. Without `:columns` the first row's keys
  are the columns.
- `(ui/input :name "q" [:label "..."] [:placeholder "..."] [:value "..."])` a text
  field · `(ui/select options :name "n" [:label "..."] [:value "..."]
  [:on-change fn])` a dropdown over a list of strings · `(ui/checkbox :name "o"
  [:label "..."] [:checked t] [:on-change fn])` a tick box.
- `(ui/button label action)` · `(ui/form action child... [:submit "Send"])`.

**Actions** are ordinary Lisp functions, and a button's or form's action runs IN
THIS REPL when the user uses it, with NO model turn in between — the user clicks,
the closure runs, the view is replaced, and you are not asked anything. That is
what makes a view worth building: every branch you anticipate becomes free.
- A button's action takes no argument: `(lambda () (ui/render (panel)))`. A form's
  takes one: an alist of every enclosed field's `:name` and its contents, read with
  `assoc`. A button INSIDE a form gets the same alist if it takes an argument.
- Field contents are always strings — except a `ui/checkbox`, whose value is a real
  boolean, so `(if (cdr (assoc "o" values)) ...)` works. `(read s)` turns a string
  field into a number. Remember `""` and `"false"` are both TRUE, which is exactly
  why the tick box does not hand you a string.
- `:on-change` on a `ui/select` or `ui/checkbox` is a one-argument function run the
  moment the user picks or ticks — no submit button, no model turn. It gets the
  same alist a form's handler would and answers the same way, by rendering. That is
  how you build a filter that reacts:

  ```
  (defun panel (window)
    (ui/stack
      (ui/select '("7" "30" "90") :name "d" :value window
        :on-change (lambda (values) (ui/render (panel (cdr (assoc "d" values))))))
      (ui/table (issues-since window))))
  (ui/render (panel "7"))
  ```

  Text fields have no `:on-change` on purpose: every keystroke would be a round
  trip that redraws the field the user is typing into. Put a `ui/input` in a
  `ui/form` and let the submit carry it.
- An action answers by calling `ui/render`. Whatever it renders replaces the view
  in place; an action that renders nothing leaves the view as it was.
- Actions close over the environment where you wrote them, and the REPL is
  persistent, so `(setq counter (+ counter 1))` inside a handler sticks — a later
  step of yours reads the changed value like any other global.

**Handing work back to you: `(ui/send text...)`** — the arguments are joined like
`echo`'s and the result joins the conversation as a message from the user, so you
take the next turn and answer it normally:

```
(ui/form (lambda (values) (ui/send "search the issues for" (cdr (assoc "q" values))))
  (ui/input :name "q" :label "search")
  :submit "ask")
```

Send for judgement, handle it in Lisp for work: a request typed in prose, a
decision or a step you did not write code for needs a turn; filtering, paging,
recomputing or calling a tool you already loaded is free. A handler may render AND
send — render the view the user should be looking at while you think, then send.
Several sends in one handler join into ONE message, because one click is one thing
the user did. Only handlers deliver: `ui/send` in your own step does nothing, you
are already taking a turn. Write it as a request (`"search the issues for auth"`),
not as a note to yourself (`"user clicked search"`).

**Rules of thumb**
- `ui/render` is the ONLY thing that draws. Building a widget and not rendering it
  shows nothing, exactly like computing a value and not echoing it.
- A step that renders a view shows the user the WIDGET instead of its text output,
  so put anything they should read inside the widget rather than in an `echo`.
- Echo when the answer is something to read; render when it is something to use —
  when it has something to DO in it, a filter to change, a row to act on, a choice
  to make.
- You are told only that the render happened (`rendered stack, 8 elements, 3
  actions`); the widget is never sent back to you, because describing it to
  yourself would spend exactly the context that drawing it saved.
