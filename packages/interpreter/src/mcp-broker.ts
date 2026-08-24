/*
 * MCP broker — the domain half of an async worker, runs inside a worker_threads
 * Worker.
 *
 * The Lisp interpreter (src/lisp.ts) is fully synchronous; MCP is async. A
 * single Node thread cannot block on its own event loop without deadlocking,
 * so all async MCP work happens here, on a separate thread with its own event
 * loop. This file owns ONLY the MCP operations (connect, call-tool, login, …);
 * the generic machinery — the SharedArrayBuffer reply bridge and the
 * background-job scheduler — lives in src/jobs-broker.ts, which this module
 * drives via `runWorker(dispatch)`. The main-thread side is src/jobs.ts +
 * src/mcp.ts.
 *
 * All MCP typing comes from the official SDK — no hand-rolled JSON-RPC.
 */
import { randomUUID } from "node:crypto";
import {
	auth,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { oauthEnv } from "@repo/env/oauth.ts";
import { runWorker } from "./jobs-broker.ts";
import {
	type CallbackServer,
	createAuthCallback,
	FileOAuthStore,
	StoredOAuthProvider,
} from "./mcp-oauth.ts";

// A connection descriptor sent by the main thread.
type ConnConfig =
	| {
			name: string;
			url: string;
			headers?: Record<string, string>;
			oauth?: boolean;
			scopes?: string[];
	  }
	| {
			name: string;
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  };

// OAuth token store (swap for a DB-backed OAuthStore here). See devdocs/oauth.md.
const oauthStore = new FileOAuthStore();

// Loopback callback port (local mode); fixed so the redirect URI is stable.
function callbackPort(): number {
	return oauthEnv.LISPTC_OAUTH_CALLBACK_PORT ?? 8909;
}

// Registered redirect_uri: cloud ingress URL, else the local loopback callback.
function redirectUri(): string {
	return (
		oauthEnv.LISPTC_OAUTH_REDIRECT_URL ??
		`http://127.0.0.1:${callbackPort()}/callback`
	);
}

// Thrown by connect() when a server needs interactive OAuth; the message carries
// the authorization URL and the next step.
class NeedsAuthError extends Error {
	constructor(server: string, authUrl: string) {
		super(
			`authorization required for "${server}": open ${authUrl} — after approving it will be captured automatically, then run (load-mcp "${server}") again (or run (mcp-authorize "${server}" "<code>"))`,
		);
	}
}

// A single long-lived callback server multiplexes every OAuth flow, so several
// outstanding login links (e.g. from concurrent background `load-mcp` jobs) can
// each complete independently. Lazily started; stays open (holding the fixed
// redirect port) for the life of the broker.
let callbackServer: CallbackServer | undefined;
async function sharedCallbackServer(): Promise<CallbackServer | undefined> {
	if (callbackServer) return callbackServer;
	try {
		callbackServer = await createAuthCallback(
			callbackPort(),
			oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		);
	} catch {
		return undefined; // port busy (e.g. another lisptc): manual mcp-authorize
	}
	return callbackServer;
}

// Register this flow's callback capture. Fire-and-forget; silent on busy port /
// timeout (the manual mcp-authorize path still works). The exchange uses THIS
// flow's `provider` — whose in-memory PKCE verifier survives even after a later
// login for the same server overwrites the stored one — so an earlier link's
// code still exchanges correctly instead of failing PKCE.
async function startCallbackCapture(
	serverUrl: string,
	scope: string | undefined,
	authUrl: URL,
	provider: StoredOAuthProvider,
): Promise<void> {
	const cb = await sharedCallbackServer();
	if (!cb) return; // port busy: fall back to manual (mcp-authorize)
	const state = authUrl.searchParams.get("state") ?? "";
	cb.waitForCode(state, undefined, (code) =>
		auth(provider, { serverUrl, authorizationCode: code, scope }).then(
			() => {},
		),
	).catch(() => {}); // timeout / superseded / exchange error: surfaced in the browser page; user can retry
}

// Live MCP clients keyed by the serverId the broker mints on connect.
const clients = new Map<string, { client: Client; tools: Tool[] }>();

// The MCP operations this broker understands.
type McpOp =
	| "connect"
	| "login"
	| "authorize"
	| "logout"
	| "list-tools"
	| "call-tool"
	| "disconnect"
	| "search";

// The MCP operations. The generic scheduler (src/jobs-broker.ts) forwards every
// non-meta op here; when run via `start`, `signal` is the job's AbortController
// signal so a slow connect / tool call can be cancelled mid-flight. Typing `op`
// as McpOp keeps the switch exhaustively checked; the scheduler casts the raw
// wire string to McpOp, so an unknown op still reaches the `default` at runtime.
async function dispatch(
	op: McpOp,
	payload: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	switch (op) {
		case "connect":
			return connect(payload as ConnConfig, signal);
		case "login":
			return login(payload as { url: string; scopes?: string[] });
		case "authorize":
			return authorize(
				payload as { url: string; code: string; scopes?: string[] },
			);
		case "logout":
			return logout(payload as { url: string });
		case "list-tools":
			return listTools((payload as { serverId: string }).serverId);
		case "call-tool":
			return callTool(
				payload as {
					serverId: string;
					tool: string;
					args: Record<string, unknown>;
				},
				signal,
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

runWorker(dispatch);

async function connect(
	conf: ConnConfig,
	signal?: AbortSignal,
): Promise<{ serverId: string; tools: Tool[] }> {
	const client = new Client(
		{ name: "lisptc", version: "1.0.0" },
		{ capabilities: {} },
	);

	// SDK performs the initialize + notifications/initialized handshake. The
	// AbortSignal (from the job's AbortController) lets (cancel job) abort a
	// slow connect/list mid-flight.
	if ("url" in conf && conf.oauth) {
		// OAuth path: a stored token connects directly (auto-refreshed); with none
		// ensureAuthorized begins authorization and returns the login URL.
		const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
		const { provider, authUrl } = await ensureAuthorized(conf.url, scope);
		if (authUrl) throw new NeedsAuthError(conf.name, authUrl);
		const transport = new StreamableHTTPClientTransport(new URL(conf.url), {
			authProvider: provider,
		});
		try {
			await client.connect(transport, { signal });
		} catch (e) {
			if (!(e instanceof UnauthorizedError)) throw e;
			// Stored token rejected: drop it and re-authorize.
			await provider.invalidateCredentials("tokens");
			const retry = await ensureAuthorized(conf.url, scope);
			throw new NeedsAuthError(conf.name, retry.authUrl ?? conf.url);
		}
	} else {
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
		await client.connect(transport, { signal });
	}
	const { tools } = await client.listTools(undefined, { signal });
	// A server that handshakes but exposes no tools is useless to lisptc (whose
	// MCP integration is tools-only) — this is the common shape of a degraded /
	// unauthenticated / wrong-URL connection, which returns an empty list rather
	// than erroring. Treat it as a load failure so it surfaces as :error instead
	// of a misleading :loaded server with no tools.
	if (tools.length === 0) {
		await client.close().catch(() => {});
		throw new Error("connected but the server exposed no tools");
	}
	const serverId = randomUUID();
	clients.set(serverId, { client, tools });
	return { serverId, tools };
}

// Exchange an authorization code for tokens using the persisted PKCE verifier +
// client registration (no live transport needed). Then (load-mcp name) connects.
async function authorize(payload: {
	url: string;
	code: string;
	scopes?: string[];
}): Promise<{ ok: true }> {
	const scope = payload.scopes?.length ? payload.scopes.join(" ") : undefined;
	const provider = await StoredOAuthProvider.create(
		oauthStore,
		payload.url,
		redirectUri(),
		scope,
	);
	const result = await auth(provider, {
		serverUrl: payload.url,
		authorizationCode: payload.code,
		scope,
	});
	if (result !== "AUTHORIZED")
		throw new Error("authorization did not complete (unexpected redirect)");
	return { ok: true };
}

// Prepare an OAuth provider and, if there's no usable token, begin authorization
// (with our curated `scope`, not the server's full scopes_supported which some
// reject as invalid_scope) and start the callback capture. Returns the provider
// and the login URL to open — or authUrl null if already authenticated.
async function ensureAuthorized(
	serverUrl: string,
	scope: string | undefined,
): Promise<{ provider: StoredOAuthProvider; authUrl: string | null }> {
	const provider = await StoredOAuthProvider.create(
		oauthStore,
		serverUrl,
		redirectUri(),
		scope,
	);
	// Drop a stale client registration bound to a different redirect URI.
	const registered = provider.clientInformation();
	if (
		registered?.redirect_uris &&
		!registered.redirect_uris.includes(redirectUri())
	) {
		await provider.invalidateCredentials("all");
	}
	if (provider.tokens()) return { provider, authUrl: null };
	await auth(provider, { serverUrl, scope });
	const authUrl = provider.authorizationUrl;
	if (!authUrl) throw new Error("no authorization URL produced");
	void startCallbackCapture(serverUrl, scope, authUrl, provider);
	return { provider, authUrl: authUrl.href };
}

// Log in to an OAuth server: begin authorization and return the login URL to
// open (null if already authenticated). The callback capture completes it in
// the background, then (load-mcp) connects.
async function login(payload: {
	url: string;
	scopes?: string[];
}): Promise<{ authUrl: string | null }> {
	const scope = payload.scopes?.length ? payload.scopes.join(" ") : undefined;
	const { authUrl } = await ensureAuthorized(payload.url, scope);
	return { authUrl };
}

// Delete a server's saved OAuth session (tokens, client registration, verifier)
// via the store's clear(), so the next connect re-authorizes from scratch.
async function logout(payload: { url: string }): Promise<{ ok: true }> {
	await oauthStore.clear(new URL(payload.url).origin);
	return { ok: true };
}

async function listTools(serverId: string): Promise<Tool[]> {
	const entry = clients.get(serverId);
	if (!entry) throw new Error(`no such server: ${serverId}`);
	const { tools } = await entry.client.listTools();
	entry.tools = tools;
	return tools;
}

async function callTool(
	payload: {
		serverId: string;
		tool: string;
		args: Record<string, unknown>;
	},
	signal?: AbortSignal,
): Promise<unknown> {
	const entry = clients.get(payload.serverId);
	if (!entry) throw new Error(`no such server: ${payload.serverId}`);
	const result = await entry.client.callTool(
		{ name: payload.tool, arguments: payload.args },
		undefined,
		{ signal },
	);
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
