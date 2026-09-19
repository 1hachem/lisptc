---
name: canvas
description: Answer with a standalone HTML page opened in the browser when a diagram, comparison, plan, walkthrough, chart, or interactive view is clearer than terminal prose.
---

# canvas

Create a complete HTML file under `/tmp`, then open it with `node
.agents/canvas/open.mjs /tmp/<name>.html`. Each page is independent and does
not update after it has opened.

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

Write a complete, self-contained HTML document.

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

## Style

Use a small CSS theme that responds to the operating-system color scheme. Give
wide tables and code blocks their own `overflow-x: auto` container.

Favour density over decoration. The point of the page is that the user reads it
faster than the terminal, not that it is pretty.
