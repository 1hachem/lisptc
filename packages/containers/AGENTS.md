# @repo/containers

How a toolkit entry runs as a container, and the docker runner that runs one.
The MCP extension's hosts run their containers through it.

Turbo tag: `platform`.

## Shape

`src/launch.ts` turns a toolkit entry into what a container runs.
`src/docker.ts` runs one on the docker of the machine it is on and hands back
the address it answers at. `src/start-wait.ts` waits on a start until it
answers, stalls or passes its ceiling.

## Rules

**This package runs containers and knows nothing of who asked.** No server
status, no MCP host, no ref, no chat. A caller that needs to know when a
container went away passes a callback and keeps its own books, so a host
built on the runner is a thin layer that reports and keys.

**A `platform` package depends on `foundation` and `static` packages only.**
The entry shapes it reads are `@repo/toolkit`'s.

**`task mcp:reap` finds what a runner left behind by its labels**, so a change
to them changes that task too.
