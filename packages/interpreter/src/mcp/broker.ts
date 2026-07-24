/*
 * MCP broker — runs inside a worker_threads Worker (see bridges/worker.ts
 * for the main-thread side and protocol.ts for the wire format).
 *
 * All async MCP SDK work happens here, on a separate thread with its own
 * event loop. Requests are dispatched without awaiting, so any number can be
 * in flight concurrently; each replies into its own shared buffers.
 *
 * Transport creation is delegated to deployment adapters (adapter.ts), so
 * new deployment targets (docker, k8s, ...) plug in without touching the
 * broker.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { registerAdapter, resolveAdapter } from "./adapter.ts";
import { httpAdapter } from "./adapters/http.ts";
import { stdioAdapter } from "./adapters/stdio.ts";
import {
	type BrokerRequest,
	type ConnConfig,
	CTRL_LENGTH,
	CTRL_SPILLED,
	CTRL_STATE,
	type Op,
	STATE_DONE,
	STATE_ERROR,
} from "./protocol.ts";

registerAdapter("stdio", stdioAdapter);
registerAdapter("http", httpAdapter);

// Live MCP clients keyed by the serverId the broker mints on connect.
const clients = new Map<string, { client: Client; tools: Tool[] }>();

if (!parentPort) throw new Error("mcp broker must run as a worker thread");
const port = parentPort;

port.on("message", (req: BrokerRequest) => {
	// Deliberately not awaited: requests are handled concurrently.
	void handle(req);
});

async function handle(req: BrokerRequest): Promise<void> {
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
		default:
			throw new Error(`unknown op: ${op as string}`);
	}
}

async function connect(
	conf: ConnConfig,
): Promise<{ serverId: string; tools: Tool[] }> {
	const transport = await resolveAdapter(conf).createTransport(conf);
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
function reply(req: BrokerRequest, state: number, json: string): void {
	const ctrl = new Int32Array(req.ctrl);
	const bytes = new TextEncoder().encode(json);
	const dataView = new Uint8Array(req.data);

	if (bytes.byteLength <= dataView.byteLength) {
		dataView.set(bytes);
		Atomics.store(ctrl, CTRL_LENGTH, bytes.byteLength);
		Atomics.store(ctrl, CTRL_SPILLED, 0);
	} else {
		// Too large for the shared buffer: spill to a temp file and hand back
		// its path (the length field then counts the path bytes).
		const path = join(tmpdir(), `lisptc-mcp-${req.id}.json`);
		writeFileSync(path, json, "utf8");
		const pathBytes = new TextEncoder().encode(path);
		dataView.set(pathBytes);
		Atomics.store(ctrl, CTRL_LENGTH, pathBytes.byteLength);
		Atomics.store(ctrl, CTRL_SPILLED, 1);
	}
	Atomics.store(ctrl, CTRL_STATE, state);
	Atomics.notify(ctrl, CTRL_STATE);
}
