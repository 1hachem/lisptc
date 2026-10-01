# @lisptc/pi

A [pi](https://pi.dev) extension that makes lisptc the language the coding agent
answers in. The model has no tools: its message *is* the program, and the
extension evaluates it and hands the result back for the next step.

## Run it

```bash
pnpm --filter @lisptc/pi pi
```

Or point pi at it yourself, from the directory you want it to work in:

```bash
pi --extension /path/to/lisptc/apps/pi
```

To keep it, install the package once instead:

```bash
pi install /path/to/lisptc/apps/pi
```

Pi supplies the terminal UI, the model providers (`/login`), sessions,
compaction, themes and keybindings. Everything past that is lisptc.

## What a turn looks like

You ask for something. The model replies with forms, with its prose around
them:

```
Let me look at what the server exposes.

(await (load-mcp "acme"))
```

The extension evaluates that, shows you the result, and gives the model the
same result as `{"type":"tool_result","source":"lisp-repl",...}`. It keeps
going, one step at a time, until the model replies with prose and no form —
that is what ends the turn. The REPL is persistent, so a function defined on
one step is still there on the next.

Press the expand key on a result to see the exact JSON the model received.
