---
name: chrome-agent
description: Drive and observe a real Chrome from the terminal over the Chrome DevTools Protocol, using the chrome-agent CLI. Use when checking a change in a real browser, reading page state or console errors from a running dev server, reproducing a UI bug, capturing a screenshot, watching network traffic, or calling a same-origin API as the logged-in page.
---

# chrome-agent

`chrome-agent` addresses a Chrome instance by name and sends it any CDP command,
or streams any CDP event. It is already on `PATH` in this repo's dev shell, and
`CHROME_AGENT_CHROME` points at the same Playwright Chromium the MCP browser
uses, so `chrome-agent launch` needs no setup.

Reach for it when Playwright MCP is the wrong shape for the job: when the
browser must stay alive across many steps, when the question is about network
traffic or console output rather than the DOM, or when you want the full
protocol rather than a curated tool surface.

## The two channels

```bash
chrome-agent <instance> Domain.method '{"param":"value"}'   # act: one command, print the result, exit
chrome-agent attach <instance> +Event +Event                # observe: stream events as JSON lines
```

A one-shot costs about 70 ms of process startup. `attach` holds the connection,
so use it for anything that must not miss an event. Each attach session has its
own subscriptions, and both channels run at the same time without interfering.

Hand `attach` to the Monitor tool with `persistent: true` to have events
interject into the session as they happen, instead of backgrounding it into a
file you have to remember to read.

## Sense then act, then sense again

Never trust what an action returns. Trust the next read. A command that returned
no error can still have done nothing, so confirm through an independent channel:
read the DOM, the console, or the network, not the return value.

After `Page.navigate`, wait on an observable condition rather than a sleep.
Poll `document.readyState` through `Runtime.evaluate`, or attach
`+Page.loadEventFired`.

## A run against this repo

```bash
pnpm dev                                    # or `pnpm --filter @lisptc/trace-viewer dev`
chrome-agent launch --headless              # names the instance lisptc-01, from the cwd
chrome-agent lisptc-01 Page.navigate '{"url":"http://localhost:3200"}'
chrome-agent lisptc-01 Runtime.evaluate '{"expression":"document.readyState","returnByValue":true}'
chrome-agent lisptc-01 Runtime.evaluate '{"expression":"document.title","returnByValue":true}'
chrome-agent stop lisptc-01
chrome-agent status                         # verify it is gone
```

Drop `--headless` to watch the window. A launched Chrome keeps running until it
is stopped, so stopping the instances you launched is part of the task, and
`status` is what proves they are gone.

Read `result.value` out of a `Runtime.evaluate` response. Screenshot bytes come
back at `data`, not `result.data`.

## Catching errors the UI does not show

```bash
chrome-agent attach lisptc-01 +Runtime.exceptionThrown +Runtime.consoleAPICalled +Network.loadingFailed
```

This is the fastest way to answer "the page looks fine, why is nothing
happening". Run it through Monitor and the failures announce themselves.

## Clicking

A synthetic `element.click()` through `Runtime.evaluate` is fine on ordinary UI.
When a synthetic click silently does nothing, escalate to trusted input events
rather than debugging the selector:

```bash
chrome-agent lisptc-01 Input.dispatchMouseEvent '{"type":"mousePressed","x":400,"y":300,"button":"left","clickCount":1}'
chrome-agent lisptc-01 Input.dispatchMouseEvent '{"type":"mouseReleased","x":400,"y":300,"button":"left","clickCount":1}'
```

React inputs need the native value setter before they see a change. The recipe
is in `reference.md`.

## Where the rest is

`chrome-agent help [Domain[.method]]` reads the schema out of the running
browser, so it is the authoritative reference for the Chrome you have, including
protocol newer than any bundled list.

`reference.md` in this directory is the upstream guide, copied from the version
pinned in `flake.nix`. It covers instance globs, tab targeting, fingerprints,
the Python API, and the gotchas. `chrome-agent guide --path` prints the copy
that ships with the installed CLI, which wins if the two ever disagree.
