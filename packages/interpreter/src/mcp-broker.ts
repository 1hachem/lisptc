/*
 * MCP broker — runs inside a worker_threads Worker.
 *
 * The Lisp interpreter (src/lisp.ts) is fully synchronous; MCP is async. A
 * single Node thread cannot block on its own event loop without deadlocking,
 * so all async MCP work happens here, on a separate thread with its own event
 * loop. The main thread posts a request and blocks on a SharedArrayBuffer via
 * Atomics.wait (see src/mcp.ts); this worker performs the SDK call and writes
 * the result back into shared memory, then Atomics.notify wakes the main
 * thread.
 *
 * Protocol (per request):
 *   main -> worker : postMessage({ id, op, payload, ctrl, data })
 *                    ctrl  = Int32Array-backed SharedArrayBuffer [state, length]
 *                    data  = SharedArrayBuffer for the UTF-8 JSON reply
 *   worker -> main : write reply bytes into `data` (or spill to a temp file),
 *                    Atomics.store(ctrl, 0, DONE|SPILL|ERROR),
 *                    Atomics.store(ctrl, 1, byteLength),
 *                    Atomics.notify(ctrl, 0)
 *
 * All MCP typing comes from the official SDK — no hand-rolled JSON-RPC.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Reply states written into ctrl[0]. Must match src/mcp.ts.
const STATE_DONE = 1;
const STATE_ERROR = 2;
const STATE_SPILL = 3; // reply too big for `data`; ctrl-length names a temp file

// A connection descriptor sent by the main thread.
type ConnConfig =
	| { name: string; url: string; headers?: Record<string, string> }
	| {
			name: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  };

type Op = "connect" | "list-tools" | "call-tool" | "disconnect" | "search";

interface Request {
	id: string;
	op: Op;
	payload: unknown;
	ctrl: SharedArrayBuffer;
	data: SharedArrayBuffer;
}

// Live MCP clients keyed by the serverId the broker mints on connect.
const clients = new Map<string, { client: Client; tools: Tool[] }>();

if (!parentPort) throw new Error("mcp-broker must run as a worker thread");
const port = parentPort;

port.on("message", (req: Request) => {
	void handle(req);
});

async function handle(req: Request): Promise<void> {
	try {
		const result = await dispatch(req.op, req.payload);
		reply(req, STATE_DONE, JSON.stringify(result ?? null));
	} catch (ex) {
		const message = ex instanceof Error ? ex.message : String(ex);
		reply(req, STATE_ERROR, JSON.stringify({ error: message }));
	}
}

async function dispatch(op: Op, payload: unknown): Promise<unknown> {
	switch (op) {
		case "connect":
			return connect(payload as ConnConfig);
		case "list-tools":
			return listTools((payload as { serverId: string }).serverId);
		case "call-tool":
			return callTool(
				payload as {
					serverId: string;
					tool: string;
					args: Record<string, unknown>;
				},
			);
		case "disconnect":
			return disconnect((payload as { serverId: string }).serverId);
		case "search":
			// v2 semantic search backend hook — reserved. See src/mcp.ts search-tools.
			throw new Error("semantic search backend not implemented");
		default:
			throw new Error(`unknown op: ${op}`);
	}
}

async function connect(
	conf: ConnConfig,
): Promise<{ serverId: string; tools: Tool[] }> {
	const transport =
		"url" in conf
			? new StreamableHTTPClientTransport(new URL(conf.url), {
					requestInit: conf.headers ? { headers: conf.headers } : undefined,
				})
			: new StdioClientTransport({
					command: conf.command,
					args: conf.args ?? [],
					// Inherit env so PATH etc. resolve; merge any explicit overrides.
					env: {
						...(process.env as Record<string, string>),
						...(conf.env ?? {}),
					},
				});

	const client = new Client(
		{ name: "lisptc", version: "1.0.0" },
		{ capabilities: {} },
	);
	// SDK performs the initialize + notifications/initialized handshake.
	await client.connect(transport);
	const { tools } = await client.listTools();
	const serverId = randomUUID();
	clients.set(serverId, { client, tools });
	return { serverId, tools };
}

async function listTools(serverId: string): Promise<Tool[]> {
	const entry = clients.get(serverId);
	if (!entry) throw new Error(`no such server: ${serverId}`);
	const { tools } = await entry.client.listTools();
	entry.tools = tools;
	return tools;
}

async function callTool(payload: {
	serverId: string;
	tool: string;
	args: Record<string, unknown>;
}): Promise<unknown> {
	const entry = clients.get(payload.serverId);
	if (!entry) throw new Error(`no such server: ${payload.serverId}`);
	const result = await entry.client.callTool({
		name: payload.tool,
		arguments: payload.args,
	});
	if (result.isError) {
		const text = extractText(result.content);
		throw new Error(text || `tool ${payload.tool} returned an error`);
	}
	// Prefer structured output when present. Otherwise, collapse an all-text
	// content array to a plain string (the common case), else return it raw.
	if (result.structuredContent !== undefined) return result.structuredContent;
	const content = result.content;
	if (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every((c) => c?.type === "text")
	) {
		return content.map((c) => (c as { text: string }).text).join("\n");
	}
	return content ?? null;
}

async function disconnect(serverId: string): Promise<{ ok: true }> {
	const entry = clients.get(serverId);
	if (!entry) throw new Error(`no such server: ${serverId}`);
	await entry.client.close();
	clients.delete(serverId);
	return { ok: true };
}

// Concatenate the text parts of a CallToolResult content array (for errors).
function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c?.type === "text")
		.map((c) => c.text)
		.join("\n");
}

// Write the JSON reply into shared memory (or spill a large reply to a temp
// file), then wake the blocked main thread.
function reply(req: Request, state: number, json: string): void {
	const ctrl = new Int32Array(req.ctrl);
	const bytes = new TextEncoder().encode(json);
	const dataView = new Uint8Array(req.data);

	if (bytes.byteLength <= dataView.byteLength) {
		dataView.set(bytes);
		Atomics.store(ctrl, 1, bytes.byteLength);
		Atomics.store(ctrl, 0, state);
	} else {
		// Too large for the shared buffer: spill to a temp file and hand back
		// its path (length field is repurposed as the path byte length).
		const path = join(tmpdir(), `lisptc-mcp-${req.id}.json`);
		writeFileSync(path, json, "utf8");
		const pathBytes = new TextEncoder().encode(path);
		dataView.set(pathBytes);
		Atomics.store(ctrl, 1, pathBytes.byteLength);
		Atomics.store(ctrl, 0, state === STATE_ERROR ? STATE_ERROR : STATE_SPILL);
	}
	Atomics.notify(ctrl, 0);
}
