# Lisptc Language Reference

Lisptc is a Common-Lisp-like dialect: a single interpreter with cons cells, symbols,
lexical scoping, macros, tail-call optimization, and a small standard library
(the "prelude"). This document is the authoritative description of the language,
its data types, every built-in, and its standard library. If a name is not listed
here, it does not exist — define it yourself.

## 1. Syntax

Source is s-expressions. `(f a b)` calls `f` with the evaluated `a` and `b`.

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
- **Comments** (`;`) are FORBIDDEN — the interpreter warns and ignores them. Write
  self-explanatory code with no comments.
- **Symbols**: any token that is not a number/string/keyword/`nil`/`t`. `/` and `-`
  are legal in names (e.g. `string-split`, `fs/read_file`).

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
`let`, `letrec`, `while`, `dolist`, `dotimes`, `case`, `defun`, `defmacro` — is a
**prelude macro** (§8), not a core special form, but you use them the same way.
There is no `let*`, `setf`, `block`/`return-from`, `unwind-protect`, or
`throw`/`catch` pair.

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

**Eval / control**
- `(apply f args)` call `f` with the elements of list `args`.
- `(error value)` raise a catchable error carrying `value` (see §9).
- `(break)` exit the nearest loop; `(return value)` exit it with a value.

**Output** (each prints as a side effect; the REPL already echoes the value of your
last expression, so don't wrap final answers in these)
- `(prin1 x)` print re-readable form (strings quoted) · `(princ x)` human-readable
  (strings unquoted) · `(terpri)` newline · `(print x)` = `prin1` then newline.

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
- NOTE: there is no `mapc`, `reduce`, `filter`, `remove`, `nth`, `elt`, or `sort`
  in the prelude. Build them with recursion, `mapcar`, or `dolist`.

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
- `(think part...)` print reasoning as narration: parts print literally, but a
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

### Ending the loop: `halt`

`(halt "message")` — signal the REPL to stop the loop once the current program
finishes. It takes exactly ONE argument: a **double-quoted string literal** — your
final answer or message to the user, e.g. `(halt "hello world")` or
`(halt "the sum is 3")`. Never pass a bare value, symbol, or computed expression —
always a quoted string. If your answer is a number or other value, compute it in an
earlier step, then write it into the halt string literal.

- Call it ONLY when the user's request is FULLY satisfied. Do not halt early — if
  you still need to inspect a result, branch, or take another step, just emit the
  next form and you'll be asked to continue.
- `halt` only sets a stop flag; any forms after it in the SAME program still
  evaluate. So make `(halt "…")` the LAST form you emit — don't rely on it to
  short-circuit the rest of a program.
- If you never call `halt`, the loop stops on its own after a fixed number of steps
  (a safety cap), but you should end deliberately with `halt` rather than relying on
  that.
- `halt` is a REPL/driver feature, not part of the core language, so it exists only
  inside this agent loop.

## 10. MCP tools, async jobs, secrets

### 10.1 MCP servers

- `(load-mcp "name")` — load a predefined server by name. **Asynchronous**: returns
  a *job* immediately; the tools install only when the job settles.
- **To load and use in one step, wrap the SINGLE `load-mcp` call in `await`:**
  `(await (load-mcp "playwright"))` blocks until ready and returns the tool list.
  Do NOT call `(load-mcp "playwright")` and then `(await (load-mcp "playwright"))` —
  that starts TWO separate connections. Either wrap it directly as above, or bind
  the one job and await that: `(setq j (load-mcp "playwright")) … (await j)`.
- Ad-hoc servers (all still wrapped in `await` the same way):
  - Remote: `(load-mcp :name "x" :url "https://..." :headers '(("Authorization" . "Bearer …")))`
  - Local stdio: `(load-mcp :name "fs" :command "npx" :args '("-y" "server-filesystem" "/tmp"))`
  - OAuth remote: add `:oauth t` (and optional `:scopes`); then use `login`/`mcp-authorize`.
- Load several concurrently: `(await-all (list (load-mcp "a") (load-mcp "b")))`.
- **Finding tools — two different searches, don't confuse them:**
  - `(search-mcps "query")` searches the *toolkit* of predefined servers (loaded or
    not) — use this to find a server to load. Also `(list-mcps)`, `(list-toolkit)`.
  - `(search-tools "query")` searches the tools of *already-loaded* servers by
    name/description, ranked best-first. It takes ONE query string and searches
    ALL loaded servers — there is NO server argument. `(search-tools "playwright" "navigate")`
    is WRONG (arity error). To search one server's tools, load it first, then
    `(search-tools "navigate")`; to list them use `(list-tools "playwright")`.
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
  `(linear/list-issues :query "auth bug")`. Inspect one with `(doc 'linear/list-issues)`.
- Full example — load, find the tool, call it:
  ```
  (await (load-mcp "playwright"))
  (search-tools "navigate")
  (playwright/browser_navigate :url "https://hyko.ai")
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
  Example: `(load-mcp :name "linear" :url "…" :headers (list (cons "Authorization" (secret "REPL_LINEAR_TOKEN"))))`.

## 11. Gotchas

- Only `nil` is false — `0`, `0.0`, and `""` are all TRUE.
- Integer division: `/` gives a float; use `truncate` for an exact integer.
- Integer vs float shows in output as `3` vs `3.0`.
- No `nth`/`reduce`/`filter`/`mapc`/math library — write them or use `mapcar`/`dolist`/recursion.
- No `let*`: use nested `let`, or `letrec` for mutually-referential bindings.
- No character type: chars are one-character strings.
- Comments are forbidden.
- The REPL prints your last expression's value automatically — don't wrap final
  answers in `print`/`princ`.
