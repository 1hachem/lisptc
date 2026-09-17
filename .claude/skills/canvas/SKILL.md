---
name: canvas
description: Answer on a live HTML page in the browser instead of the terminal. Use when the answer is visual or long — a diagram, a table, a comparison, an architecture sketch, a plan, a multi-file walkthrough, a chart, anything interactive — or when the user asks to see something on the canvas. The page updates itself, so never tell the user to refresh.
---

# canvas

A local server watches one HTML file per Claude Code session and pushes every
change to the open browser tab over SSE. You write the file, the user reads the
page. They answer back in the terminal.

The session's page and URL arrive in the SessionStart context:

```
/home/hachem/lisptc/.claude/canvas/sessions/<session-id>.html
http://localhost:4599/s/<session-id>
```

If that context is missing, run `node .claude/canvas/bootstrap.mjs <<< '{}'` to
get a page and a URL back, or read the newest file under
`.claude/canvas/sessions/`.

To open the page in the user's browser, run `node .claude/canvas/open.mjs
<session-id>`. Without an id it opens the most recently written session. It
starts the server if it is not already up and prints the URL it opened.

## When to use it

Use the page when the terminal is the wrong medium:

- anything with shape — architecture, call graphs, state machines, timelines
- a comparison or a matrix of more than three rows
- a plan, a checklist, a staged migration
- a walkthrough touching several files, where code and prose interleave
- numbers worth charting
- anything the user should be able to click, toggle, filter or step through

Keep the terminal for short factual answers, one-line confirmations, command
output, and anything under a paragraph. Do not mirror the page into the terminal.
After writing the page, reply in one or two lines saying what landed there.

## Writing the page

Write a complete, self-contained HTML document with the `Write` tool. Replace the
whole file for a fresh answer; use `Edit` to extend or amend what is already on
the page when the user is following a thread.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>short name for the tab</title>
<style>
	.card { border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
</style>
</head>
<body>
<h1>What this answers</h1>
<div class="card">…</div>
</body>
</html>
```

The shell keeps a sticky status bar, a session picker, sensible typography and a
`72rem` content column. It takes the `<title>`, the `<head>` styles and scripts,
and the `<body>` content. Anything else in the document is dropped.

## Rules the swap imposes

The shell replaces the body in place rather than reloading, so scroll position
and the tab survive a rewrite. Two consequences:

- **Inline scripts run inside a function.** A top-level `const` would otherwise
  throw on the second write. Attach handlers with `addEventListener`, not with
  `onclick="…"` attributes, and hang anything a later script needs off `window`.
- **Scripts re-run on every write.** Make them idempotent: build from the DOM you
  just wrote, never append to state left over from the last version.

`<script type="module">` and `<script src>` are passed through untouched, in
order. There is no CSP: any CDN works. Prefer inline SVG and plain CSS over
pulling a library for a box and an arrow.

## Style

Theme tokens are already defined on `:root` and follow the OS theme: `--bg`,
`--fg`, `--muted`, `--line`. Use them instead of hard-coded colors so the page
works in both themes. Give wide tables and code blocks their own
`overflow-x: auto` container.

Favour density over decoration. The point of the page is that the user reads it
faster than the terminal, not that it is pretty.
