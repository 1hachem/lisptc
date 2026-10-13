# @lisptc/mcp-operator

The kubernetes operator that runs a workspace's MCP servers. On a cluster the
app asks for a server, and only this app runs one.

Turbo tag: `product`.

## Shape

`src/main.ts` wires the watches, the queue and the sweep, and is the only file
that reads the env or builds a real client. `src/controller.ts` holds the queue
and the resync. `src/reconcile.ts` decides what one `McpServer` needs and
`src/sweep.ts` what nothing owns any more. `src/workload.ts` builds every object
the operator creates, and `src/state.ts` reads a pod's health.

Everything that touches the cluster goes through the `Cluster` and `Servers`
ports in `src/cluster.ts`. Everything that touches Convex goes through
`StatusSink` in `src/status-sink.ts`.

The resource's shape is owned by `@repo/mcp-extension/kubernetes`, and its schema
by `charts/lisptc/crds`. A test fails when they disagree.

## Rules

**A claim is never deleted to recover from anything.** A failure recreates the
pod, idling sleeps it, and only a `Delete` reclaim, a raised `reset`, or a
retention that has run out drops data.

**One operator per release, and it touches only its own prefix.** Every sweep
filters on the namespace prefix it was given, because previews share the cluster.

A reconcile is idempotent and writes status only when it changed. Anything it
cannot finish yet it returns as a requeue, never as a wait inside the call.

What the cluster lets this do is granted in `charts/lisptc/templates/mcp-operator.yaml`,
so a new kind of object needs a rule there too.

## Tests

Tests hand the reconcile a fake cluster from `test/helpers.ts`, never a real
one. A behaviour in the claim lifecycle gets a case in `test/reconcile.test.ts`.
