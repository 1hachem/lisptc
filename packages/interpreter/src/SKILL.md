# Lisptc Language Reference

Lisptc is a Common-Lisp-like dialect: a single interpreter with cons cells, symbols,
lexical scoping, macros, tail-call optimization, and a small standard library
(the "prelude"). This document is the authoritative description of the language,
its data types, every built-in, and its standard library. If a name is not listed
here, it does not exist — define it yourself.

## 1. Syntax

Source is s-expressions. `(f a b)` calls `f` with the evaluated `a` and `b`.

Only the parenthesised top-level forms are program text: anything written around
them is prose and is ignored, so a program can be prose with forms embedded in it
(`Let me square it: (sq 5)` evaluates just `(sq 5)`). Three consequences: a bare
value at top level (`42`, `"done"`, `my-var`) is prose, not an expression to
evaluate — wrap it in a form; a stray parenthesis in prose is still read as
code, so never write one (no `:)`); and prose cannot hold a `<` or a `[` at all
— write "less than", or put the comparison in a form, `(< 1 2)`.

- **Quote**: `'x` ≡ `(quote x)` — returns `x` unevaluated.
- **Quasiquote**: `` `x `` ≡ `(quasiquote x)`. Inside it, `,x` (`unquote`) inserts
  the evaluated `x`, and `,@x` (`unquote-splicing`) splices a list. Example:
  `` `(a ,(+ 1 2) ,@(list 3 4)) `` → `(a 3 3 4)`.
- **Lists**: `(a b c)`. Dotted pair: `(a . b)` is a single cons cell.
- **Strings**: `"..."` with escapes `\\ \" \n \r \f \b \t \v`. There is no character
  type — a "character" is just a one-character string.
- **Keywords**: `:foo` is a self-evaluating keyword (interned, so `(eq :a :a)` is `t`).
- **Numbers**: see §4. `nil` and `()` are the same value (the empty list / false).
  `t` is canonical true.
- **Comments**: there is no comment syntax — prose around the forms is the comment.
  `;` is an ordinary symbol character, so `; note` inside a form is read as code.
- **Symbols**: any token that is not a number/string/keyword/`nil`/`t`. `/` and `-`
  are legal in names (e.g. `string-split`, `acme/get_widget`).

## 2. Data types

- **nil** = `()` = `null` = the empty list = the ONLY false value.
- **t** = canonical true. (Everything except `nil` is truthy, including `0`, `""`,
  and empty structures.)
- **Cons cell** — a pair `(car . cdr)`; lists are chains of cells ending in `nil`.
- **Symbol** — an interned name; `gensym`/`make-symbol` create uninterned ones
  (printed `#:name`).
- **Keyword** — `:foo`, self-evaluating.
- **String** — text; no separate char type.
- **Number** — exact integer (bigint) or inexact float; see §4.
- **Function / closure / macro** — created by `lambda` / `defun` / `defmacro`.
- **Secret** — a tainted string wrapper; see §10.3.

**Truthiness**: only `nil` is false. Test emptiness with `null`/`not`, not by
relying on `0` or `""` being false — they are TRUE.

## 3. Special forms

These are evaluated specially (not ordinary function calls). This is the complete
list of core special forms:

| Form | Shape | Meaning |
|------|-------|---------|
| `quote` | `(quote x)` | Return `x` unevaluated (`'x`). |
| `progn` | `(progn e...)` | Evaluate in order, return the last. |
| `cond` | `(cond (test body...) ...)` | First clause with non-nil `test`: eval its body, return last (or the test value if no body). Else `nil`. |
| `setq` | `(setq name val ...)` | Assign `val` to variable `name` (one or more pairs). Returns last value. Defines/updates a global if `name` isn't a local. |
| `lambda` | `(lambda (args...) body...)` | Anonymous function (a closure over the current scope). |
| `macro` | `(macro (args...) body...)` | Anonymous macro. Top-level only; normally use `defmacro`. |
| `quasiquote` | `` `x `` | Template with `,`/`,@` (see §1). |
| `try` | `(try body (catch (e) handler...))` | Eval `body`; on error, bind `e` to the error value and run the handler. See §9. |

Everything else that looks like a form — `if`, `when`, `unless`, `and`, `or`,
`let`, `let*`, `letrec`, `while`, `dolist`, `dotimes`, `case`, `defun`,
`defmacro` — is a **prelude macro** (§8), not a core special form, but you use
them the same way. There is no `setf`, `block`/`return-from`, `unwind-protect`,
or `throw`/`catch` pair.

Tail calls are optimized: deep recursion in tail position (and loop macros) does
not overflow the stack. Prefer tail-recursive helpers or the loop macros for
iteration.

## 4. Numbers

Two representations:

- **Integer literals are exact bigints**: `42` is a bigint.
- **Anything with a decimal/exponent is an inexact float**: `42.0`, `4.2e1` are floats.

Rules:

- `+ - *` keep exactness: bigint⊕bigint → bigint. Mixing in ANY float makes the
  whole result a float ("float contagion"): `(+ 1 2)` → `3`, `(+ 1 2.0)` → `3.0`.
- **`/` is ALWAYS a float**, even for evenly-divisible integers: `(/ 6 2)` → `3.0`.
  For exact integer division use `truncate` (returns a bigint): `(truncate 6 2)` → `3`.
- Output disambiguates: an integer-valued float prints with a trailing `.0`
  (`3.0`); a bigint prints bare (`3`).
- `=`/`eql` compare numerically across types: `(= 3 3.0)` → `t`.
- Division by zero: `/` follows JS (`(/ 1 0)` → `Infinity`, `(/ 0 0)` → `NaN`, no
  error), but integer `truncate`/`%`/`mod` on bigints throws. Guard divisors.

Arithmetic built-ins:

- `(+ n...)` sum (0 if none) · `(* n...)` product (1 if none) ·
  `(- n m...)` subtract / negate one arg · `(/ n m...)` float divide.
- `(% x y)` remainder (sign of `x`; alias `rem`) · `(mod x y)` modulo (sign of `y`) ·
  `(truncate x [y])` truncate toward zero → bigint.
- `(< x y)` less-than (primitive). Prelude adds `(> x y)`, `(>= x y)`, `(<= x y)`,
  `(/= x y)`, `(= x y)`.
- `(numberp x)` is the only numeric predicate. There are NO `zerop`, `evenp`,
  `abs`, `min`, `max`, `floor`, `ceiling`, `round`, `expt`, `sqrt`, `gcd`, etc. —
  build them yourself (e.g. even: `(= 0 (% n 2))`; abs: `(if (< n 0) (- n) n)`).

## 5. Primitive built-ins (defined in the interpreter core)

**Lists & pairs**
- `(car x)` first element · `(cdr x)` rest · `(cons a b)` new cell · `(list x...)`.
- `(length x)` length of a list/string → bigint.
- `(rplaca cell x)` / `(rplacd cell x)` destructively set car/cdr (aliases
  `setcar`/`setcdr`).

**Predicates**
- `(atom x)` true if not a cons · `(eq x y)` identity · `(eql x y)` identity or
  numeric/string equality (alias `=`) · `(stringp x)` · `(numberp x)`.

**Symbols**
- `(gensym)` fresh uninterned symbol · `(make-symbol name)` · `(intern name)` ·
  `(symbol-name sym)`.

**Strings** (taint-aware, see §10.3)
- `(char s i)` one-char string at index `i`, or `nil` · `(concat s...)` concatenate
  · `(string-upcase s)` · `(string-downcase s)`.
- `(string x)` convert any value to a string — its printed form, with a string
  left as itself rather than quoted: `(string 12)` → `"12"`, `(string 'foo)` →
  `"foo"`, `(string nil)` → `"nil"`. Use it to put a number in text:
  `(concat "Chapter " (string n))`. `concat` takes strings only, so a number has
  to go through `string` first. A float keeps its `.0` (`(string 3.0)` → `"3.0"`),
  so `(string (truncate x))` is the way to a bare integer.

**Parsing text into data**
- `(read s)` parse the FIRST Lisp expression in the string `s` and return it as
  data, unevaluated: `(read "(+ 1 2)")` → the list `(+ 1 2)`, not `3`. Text after
  that expression is ignored; a string with no expression errors.
- `(json-parse s)` parse a JSON document: object → alist with string keys, array
  → list, `true` → `t`, `false` and `null` → `nil`. Numbers arrive as floats
  (`7` reads back as `7.0`; `=` still compares them numerically).
  `(cdr (assoc "title" (json-parse s)))` reads a field.
- The two are different parsers, not aliases: JSON is not Lisp syntax, so `read`
  on a JSON document returns junk (`{` is an ordinary symbol character, so
  `{"a": 1}` reads as the symbol `{`) rather than erroring. Use `json-parse` for
  JSON, `read` for Lisp.

**Eval / control**
- `(apply f args)` call `f` with the elements of list `args`.
- `(error value)` raise a catchable error carrying `value` (see §9).
- `(break)` exit the nearest loop; `(return value)` exit it with a value.

**Output** — `echo` is the ONLY thing that prints. The REPL prints nothing on its
own (see §9), so nothing you compute is seen by anyone until you echo it.
- `(echo x...)` print the arguments, space-separated, one newline at the end:
  strings as they are, everything else re-readable. `(echo)` is a blank line.
- `(echo x :offset 0 :length n)` print a window of `x`, counted in
  whitespace-separated words; the `...` line it ends with gives the offset to
  continue from.
- `(echo x :match "re" :context 8 :max 10 :ignore-case t)` print only the
  regions matching a regular expression, each as `@<word-offset>` plus the
  surrounding words with the match in `[[ ]]`. Feed a reported offset back in as
  `:offset`. Use this to READ a value; use `grep` to KEEP what matched.

**Extracting** — these RETURN a value (so the REPL names it, §9) instead of
printing. Extract into a name, then `echo` a rendering of it.
- `(head x [n])` the first `n` of `x`; `(tail x [n])` the last `n`. On a list,
  `n` ELEMENTS — `(head issues 4)` is the first four rows. On text, `n` words.
- `(grep x "pattern" :group n :max n :ignore-case t)` what `pattern` matched, as
  a list, or `nil`. On a list, the ELEMENTS whose printed form matches:
  `(grep issues "auth")` is the issues about auth. On text, the matched
  substrings: `(grep page "https?://[^ ]+")` is the URLs in it.

**Introspection**
- `(doc name)` print a binding's signature+doc; `(doc)` lists all documented names.
- `(dump)` list every global symbol · `(import "path")` load+eval a Lisp file.

Globals: `*gensym-counter*`, `*version*`.

## 6. Prelude standard library

Everything below is available by default.

**List access** — composed car/cdr: `caar cadr cdar cddr caaar caadr cadar caddr
cdaar cdadr cddar cdddr`. (`cadr` = 2nd, `caddr` = 3rd element, etc.)

**List building / manipulation**
- `(append list...)` concatenate lists (non-destructive).
- `(nreverse list)` reverse destructively · `(last list)` last cons cell ·
  `(nconc lists...)` destructive concat.
- `(mapcar f list)` new list of `f` over each element. Example:
  `(mapcar (lambda (n) (* n n)) '(1 2 3))` → `(1 4 9)`.
- `(nth n list)` the element at index `n`, counting from 0; `nil` past the end.
- NOTE: there is no `mapc`, `reduce`, `filter`, `remove`, `elt`, or `sort` in the
  prelude. Build them with recursion, `mapcar`, or `dolist`.

**Predicates**
- `(not x)` / `(null x)` true if `nil` · `(consp x)` true if a cons ·
  `(listp x)` true if `nil` or a cons · `(equal x y)` deep structural equality.

**Membership / alists**
- `(memq key list)` tail from first `eq` match · `(member key list)` first `equal`
  match · `(assq key alist)` first pair with `eq` car · `(assoc key alist)` first
  pair with `equal` car. Read an alist field:
  `(cdr (assoc "content" msg))`.

**Control-flow macros**
- `(if test then else...)` · `(when test body...)` · `(unless test body...)` ·
  `(and x...)` (nil on first nil, else last) · `(or x...)` (first non-nil) ·
  `(case key (keys forms...) ... (t default...))` — matches `key` by `equal`
  against each clause's key list; `t` clause is the default.

**Binding macros**
- `(let ((name val)...) body...)` parallel bindings (a bare `name` binds `nil`).
- `(let* ((name val)...) body...)` sequential bindings — each `val` may use the
  names bound before it, e.g.
  `(let* ((issue (car issues)) (state (cdr (assoc "state" issue)))) …)`.
- `(letrec ((name val)...) body...)` bindings may reference each other — use for
  local recursive functions.

**Loops** (support `(break)` and `(return value)`)
- `(while test body...)`.
- `(dolist (name list [result]) body...)` iterate elements.
- `(dotimes (name count [result]) body...)` iterate `0..count-1`.

**Defining**
- `(defun name (args...) [doc] body...)` define a function; `&rest x` for variadic.
- `(defmacro name (args...) [doc] body...)` define a macro.

**Strings** (taint flows through all of these)
- `(substring s start [end])` · `(string-prefix? p s)` · `(string-suffix? p s)` ·
  `(string-index s sub [start])` → index or `nil` · `(string-contains? s sub)` ·
  `(string-count s sub)` · `(string-replace s old new)` ·
  `(string-split s sep)` (empty `sep` → characters) · `(string-join list sep)` ·
  `(string-trim s)`.

**Misc**
- `(identity x)` return `x`.
- `(think part...)` echo reasoning as narration: parts print literally, but a
  `,x` part is evaluated first (e.g. `(think "sum is" ,(+ 1 2))`). Returns `nil`;
  put the real answer in a separate expression.

## 7. Macros

`defmacro` defines a compile-time transformer. Build the expansion with quasiquote:

```
(defmacro swap (a b)
  `(let ((tmp ,a)) (setq ,a ,b) (setq ,b tmp)))
```

Use `(gensym)` for temporaries you introduce, to avoid capturing user variables.
Macros expand up to 20 nesting levels at compile time.

## 8. Errors & control flow

- `(error value)` raises; `value` can be any Lisp value (often a string).
- `(try expr (catch (e) handler...))` evaluates `expr`; if it raises, `e` is bound
  to the raised value and the handler runs. This is the ONLY error mechanism —
  there is no condition system, no `unwind-protect`.

```
(try (/ 1 0) (catch (e) (concat "failed: " e)))
```

- `(break)` / `(return value)` escape the nearest `while`/`dolist`/`dotimes`.
  Using them outside a loop is an error.

## 9. The REPL loop

The session is persistent: definitions from earlier steps stay available; build on
them. You act one step at a time — emit a form, read its result, decide the next.
Three read-only globals mirror the conversation and refresh every step:

- `conversation` — list of messages; each is an alist with `"role"` and `"content"`.
  Read a field: `(cdr (assoc "content" (car conversation)))`.
- `user-messages` — list of the user's message strings.
- `assistant-messages` — list of your prior message strings.

They are read-only (re-assigning them doesn't persist); copy into your own variable
to keep a value.

### The REPL is silent: it names your result and describes its shape

Nothing is printed unless you `echo` it. Every result is bound to a variable —
named after the function that produced it — and reported as one line saying
what is in it:

```
(acme/list-issues :query "auth bug")
acme/list-issues-1: list of 27 alists, keys "id" "identifier" "title" "state" "url"

(+ 1 2)
+-1: 3
```

A small value is reported as itself; a large one is described (`list of 27
alists, keys …`, `3412 words`, `200 characters`). Either way **the variable
holds the whole value.** A `setq` or `defun` is reported under the name it
already bound, and `nil`/`t` report plainly — there is nothing to name.

**Never retype data the REPL produced.** Refer to the variable: it holds the
exact value, costs a handful of tokens, and cannot be misremembered. Re-emitting
a list, an id, a title or a body by hand is wasted output and the main way you
produce wrong data. Build on the name —
`(mapcar (lambda (i) (cdr (assoc "id" i))) acme/list-issues-1)`.

### Extract into a name, then echo a rendering of it

The shape line tells you what you need to write the next form. Two moves cover
almost everything: `head`/`tail`/`grep` to pull out a value (which the REPL then
names), and `echo` to show a rendering of it.

To answer with something the REPL produced, compute the answer and echo THAT:

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

Both wrong versions look like this — never do either:

```
(echo "https://x.dev/a")                      the URL typed from a printout
(echo "| ENG-12 | Auth token refresh fails |")   the rows typed out by hand
```

You cannot retype what you were never shown, which is why the REPL describes a
result instead of printing it. Prefer computing over reading: `(length x)`,
`mapcar`, `assoc` and `grep` work on the complete value, and one form that
extracts what you need beats paging through text.

### Echo output is capped for you, not for the user

A step may echo a fixed number of words. Past that the text you see stops and a
`...` line says how much is left and how to continue:

```
(echo range-1)
(39 38 37 36 35 34
... 6 of 40 words shown, 34 below — read on with (echo range-1 :offset 6)
```

The user reading the conversation sees the whole output; the cap is on your copy
alone. So when you see that line: do not re-run the call, and do not answer from
the fragment — page on with the offset it gave you, or `(echo range-1 :match
"pattern")` when you know what you are looking for. Output that is one unbroken
word (minified JSON, say) is cut by character instead, and the `...` line points
at `substring`. Several echoes in one step share the budget; when it runs out you
are told how many words you were not shown.

### Ending the loop: prose alone

There is no `halt`, `exit` or `quit`. You end the loop by replying with **prose and
no form at all** — a message with nothing to evaluate is a program that does
nothing, and that is the signal that you are done. The prose you write is your final
answer to the user, e.g. `the sum is 3`.

- Reply that way ONLY when the user's request is FULLY satisfied. Until then every
  reply must carry at least one form — if you still need to inspect a result,
  branch, or take another step, emit the next form and you'll be asked to continue.
- The corollary of §1: prose around a form is ignored, but prose *instead of* a form
  stops the loop. So never answer in bare prose mid-task, and never park a plan or a
  note in a form-less message — put remarks around the form you are emitting.
- The loop also stops on its own after a fixed number of steps (a safety cap), but
  end deliberately with your answer rather than relying on that.
- This is a REPL/driver behaviour, not part of the core language: outside the agent
  loop a form-less program is simply a no-op.

## 10. MCP tools, async jobs, secrets

### 10.1 MCP servers

- `(load-mcp "name")` — load a predefined server by name. **Asynchronous**: returns
  a *job* immediately; the tools install only when the job settles.
- **To load and use in one step, wrap the SINGLE `load-mcp` call in `await`:**
  `(await (load-mcp "acme"))` blocks until ready and returns the tool list.
  Do NOT call `(load-mcp "acme")` and then `(await (load-mcp "acme"))` —
  that starts TWO separate connections. Either wrap it directly as above, or bind
  the one job and await that: `(setq j (load-mcp "acme")) … (await j)`.
- Ad-hoc servers (all still wrapped in `await` the same way):
  - Remote: `(load-mcp :name "x" :url "https://..." :headers '(("Authorization" . "Bearer …")))`
  - Local stdio: `(load-mcp :name "acme" :command "npx" :args '("-y" "acme-mcp-server"))`
  - OAuth remote: add `:oauth t` (and optional `:scopes`); then use `login`/`mcp-authorize`.
- Load several concurrently: `(await-all (list (load-mcp "a") (load-mcp "b")))`.
- **Finding tools — two different searches, don't confuse them:**
  - `(search-mcps "query")` searches the *toolkit* of predefined servers (loaded or
    not) — use this to find a server to load. Also `(list-mcps)`, `(list-toolkit)`.
  - `(search-tools "query")` searches the tools of *already-loaded* servers by
    name/description, ranked best-first. It takes ONE query string and searches
    ALL loaded servers — there is NO server argument. `(search-tools "acme" "widget")`
    is WRONG (arity error). To search one server's tools, load it first, then
    `(search-tools "widget")`; to list them use `(list-tools "acme")`.
- `(unload-mcp "name")`, `(login "name")`, `(logout "name")`,
  `(mcp-authorize "name" "code")`, `(mcp-shutdown)`.
- **OAuth login/logout lifecycle** (only for `:oauth t` servers):
  - `(login "name")` begins authorization and returns the login URL to open (or
    `:logged-in` if already authenticated). After approving, `(load-mcp "name")`
    connects.
  - `(logout "name")` → `:logged-out`. Unloads the server if it's loaded AND
    deletes its saved tokens, so the next `(load-mcp "name")` / `(login "name")`
    re-authorizes from scratch. Use it to sign out, or to force a fresh consent
    after widening a server's `:scopes` (e.g. a tool call returned
    `403 insufficient_scope`): `(logout "name")` then `(login "name")` again.
  - Both `login` and `logout` only accept a **predefined OAuth server name**;
    calling them on an unknown/non-OAuth server errors. `logout` is a no-op-safe
    sign-out — it doesn't error if the server isn't currently loaded.
- Each loaded tool becomes a global `<server>/<tool>` called with keyword args and
  **blocking** (returns the result directly), e.g.
  `(acme/list_widgets :query "blue")`. Inspect one with `(doc 'acme/list_widgets)`.
- A tool result arrives already converted to Lisp data (JSON object → alist with
  string keys, array → list), so read it with `assoc`/`cdr`/`mapcar`/`nth` — no
  parsing step. Only when a tool hands back a *string* that happens to contain
  JSON do you need `(json-parse s)` (§5).
- Full example — find the server, load it, find the tool, call it. The server and
  tool names below are made up: you never know them in advance, so start from
  `search-mcps` and let each step tell you the next name.
  ```
  (search-mcps "widget")
  (await (load-mcp "acme"))
  (search-tools "widget")
  (acme/get_widget :id "42")
  ```

### 10.2 Async jobs

A *job* is a handle for background work (currently just `load-mcp`).
- `(await job [timeout-ms])` block for the result (re-raises the job's error).
- `(await-all jobs [ms])` list of results in order (a failed one → `(:error "msg")`).
- `(await-any jobs [ms])` first result.
- `(job-status job)` → `:pending` / `:done` / `:error` (non-blocking).
- `(jobs)` list in-flight jobs · `(cancel job)` abort one.

### 10.3 Secrets

- `(secrets)` → alist of `(key . description)`; values hidden.
- `(secret "REPL_TOKEN")` → the value as a **tainted string**. It behaves like a
  string in all string functions and taint propagates through the result, but it
  prints redacted as `#<secret:KEY>` and is only revealed when serialized into an
  outgoing MCP call argument or header. Only `REPL_`-prefixed keys are visible.
  Example: `(load-mcp :name "acme" :url "…" :headers (list (cons "Authorization" (secret "REPL_ACME_TOKEN"))))`.

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

**Constructors** (each returns a widget; none of them draws anything on its own)
- `(ui/text s)` a line · `(ui/heading s)` · `(ui/markdown s)` a block of markdown.
- `(ui/stack child...)` one above the next · `(ui/row child...)` side by side. A
  bare string child becomes `ui/text`.
- `(ui/card title child...)` a titled box. Break a long view into named parts;
  with no cards a big `ui/stack` reads as one wall of things.
- `(ui/kpi label value [:hint "…"])` one number, big — `(ui/kpi "open" 27)`. The
  most understanding per token of anything here: it says at a glance what a
  27-row table says in a screenful. `:hint` is a smaller line under it.
- `(ui/badge text [:tone "ok"])` a short status label, `:tone` one of `ok` `warn`
  `bad` `info` `muted`. For the *state* of a thing — a status, a severity, a
  check's result — where a sentence would be noise.
- `(ui/link text url)` a link, opened in a new tab. Use it for a URL a tool
  handed you so the user can follow it instead of copying it out of a table.
- `(ui/table rows [:columns '("id" "title")])` — `rows` is a list of alists, the
  shape an MCP tool result usually has. Without `:columns` the first row's keys
  are the columns.
- `(ui/input :name "q" [:label "…"] [:placeholder "…"] [:value "…"])` a text field
  · `(ui/select options :name "n" [:label "…"] [:value "…"] [:on-change fn])` a
  dropdown over a list of strings · `(ui/checkbox :name "o" [:label "…"]
  [:checked t] [:on-change fn])` a tick box.
- `(ui/button label action)` · `(ui/form action child... [:submit "Send"])`.

**Actions** are ordinary functions, and they run **in this REPL with no model turn
in between** — the user clicks, the closure runs, the view is replaced, and you
are not asked anything. That is what makes a view worth building: every branch you
anticipate becomes free.
- A button's action takes no argument: `(lambda () (ui/render (panel)))`.
- A form's action takes one: an alist of every enclosed field's `:name` and its
  contents, read with `assoc`. A button INSIDE a form gets the same alist if it
  takes an argument.
- Field contents are always strings — except a `ui/checkbox`, whose value is a
  real boolean, so `(if (cdr (assoc "o" values)) …)` works. `(read s)` turns a
  string field into a number. Remember `""` and `"false"` are both TRUE, which
  is exactly why the tick box does not hand you a string.
- `:on-change` on a `ui/select` or a `ui/checkbox` is a one-argument function run
  the moment the user picks or ticks — no submit button, no model turn. It gets
  the same alist a form's handler would and answers the same way, by rendering.
  That is how you build a filter that reacts:

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

**Handing work back to you: `(ui/send text...)`**

A handler that reaches something it cannot answer on its own calls `ui/send`. The
arguments are joined like `echo`'s and the result joins the conversation **as a
message from the user**, so you take the next turn and answer it normally:

```
(ui/form (lambda (values) (ui/send "search the issues for" (cdr (assoc "q" values))))
  (ui/input :name "q" :label "search")
  :submit "ask")
```

- Send when the click needs *judgement* — a request typed in prose, a decision, a
  step you did not write code for. Handle it in Lisp when the click needs *work* —
  filtering, paging, recomputing, calling a tool you already loaded. The first
  costs a turn; the second is free.
- A handler may render AND send: render the view the user should be looking at
  while you think, then send.
- Several sends in one handler join into ONE message, because one click is one
  thing the user did.
- Only handlers deliver. `ui/send` in your own step does nothing — you are already
  taking a turn.
- The message arrives as a user turn, so write it as a request, not as a note to
  yourself: `"search the issues for auth"`, not `"user clicked search"`.

**Rules of thumb**
- `ui/render` is the ONLY thing that draws. Building a widget and not rendering it
  shows nothing, exactly like computing a value and not echoing it.
- A step that renders a view shows the user the view INSTEAD of its text output,
  so put anything they should read inside the widget rather than in an `echo`.
- Render when the answer has something to DO in it — a filter to change, a row to
  act on, a choice to make. Echo when it is something to read.
- You are told only that the render happened (`rendered stack, 8 elements, 3
  actions`). The widget itself is not sent back to you: describing it to yourself
  would spend exactly the context that drawing it saved.

## 12. Gotchas

- Only `nil` is false — `0`, `0.0`, and `""` are all TRUE.
- Integer division: `/` gives a float; use `truncate` for an exact integer.
- Integer vs float shows in output as `3` vs `3.0`.
- No `reduce`/`filter`/`mapc`/math library — write them or use `mapcar`/`dolist`/recursion.
- `read` parses LISP text, `json-parse` parses JSON. `read` on JSON does not
  error, it returns junk (§5).
- JSON numbers come back as floats, so an integer id prints as `7.0`; `=` and
  `eql` still compare it equal to `7`.
- No character type: chars are one-character strings.
- No comment syntax: remarks go in the prose around the forms, never inside one.
- The REPL prints NOTHING on its own (§9): it reports a result's name and shape.
  `echo` is the only way to see a value, and the only way to show one to the user.
- There is no `print`/`princ`/`terpri`/`view` — one `echo` does all of it, and
  `:offset`/`:length`/`:match` are how you window and search what it prints.
- Retyping data the REPL produced is the main way you produce wrong data (§9).
  Extract it with `grep`/`head` and echo the variable instead.
- `head`/`tail`/`grep` RETURN a value; only `echo` prints. `(head issues 4)`
  hands you the first four rows to compute with, it does not show them.
- Echo output is capped for you but not for the user (§9). Output ending in a
  `...` line is not everything — page on with the offset it gives you.
