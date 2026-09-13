import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	auth,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { oauthEnv } from "@repo/env/oauth";
import {
	type CallbackServer,
	createAuthCallback,
	FileOAuthStore,
	StoredOAuthProvider,
} from "./mcp-oauth.ts";

export interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	enum?: unknown[];
	description?: string;
	items?: JsonSchema;
	default?: unknown;
	examples?: unknown[];
}

export interface Tool {
	name: string;
	description?: string;
	inputSchema?: JsonSchema;
	outputSchema?: JsonSchema;
}

interface ConnMeta {
	description?: string;
	keywords?: string[];
}

export type HttpConnConfig = ConnMeta & {
	name: string;
	url: string;
	headers?: Record<string, string>;
	oauth?: boolean;
	scopes?: string[];
	command?: string;
	args?: string[];
	env?: Record<string, string>;
};

export type StdioConnConfig = ConnMeta & {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
};

export type ConnConfig = HttpConnConfig | StdioConnConfig;

export interface ConnectResult {
	serverId: string;
	tools: Tool[];
}

export interface ToolCall {
	serverId: string;
	tool: string;
	args: Record<string, unknown>;
}

export interface McpClient {
	connect(conf: ConnConfig, signal?: AbortSignal): Promise<ConnectResult>;
	callTool(call: ToolCall, signal?: AbortSignal): Promise<unknown>;
	disconnect(serverId: string): Promise<void>;
	login(conf: HttpConnConfig): Promise<{ authUrl: string | null }>;
	logout(conf: HttpConnConfig): Promise<void>;
	authorize(conf: HttpConnConfig, code: string): Promise<void>;
}

const oauthStore = new FileOAuthStore();

function callbackPort(): number {
	return oauthEnv.LISPTC_OAUTH_CALLBACK_PORT ?? 8909;
}

function redirectUri(): string {
	return (
		oauthEnv.LISPTC_OAUTH_REDIRECT_URL ??
		`http://127.0.0.1:${callbackPort()}/callback`
	);
}

const LOCAL_START_TIMEOUT_MS = 60_000;
const LOCAL_POLL_MS = 250;
const LOCAL_STDERR_KEEP = 4096;

interface LocalServer {
	child: ReturnType<typeof spawn>;
	stderr: string;
}

const started = new Map<string, LocalServer>();

async function reachable(url: string): Promise<boolean> {
	try {
		await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
		return true;
	} catch {
		return false;
	}
}

function startLocalServer(conf: {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}): LocalServer {
	const child = spawn(conf.command, conf.args ?? [], {
		detached: true,
		stdio: ["ignore", "ignore", "pipe"],
		env: {
			// biome-ignore lint/style/noProcessEnv: the child inherits the whole environment, no value is read here
			...(process.env as Record<string, string>),
			...(conf.env ?? {}),
		},
	});
	const server: LocalServer = { child, stderr: "" };
	child.stderr?.on("data", (chunk: Buffer) => {
		server.stderr = (server.stderr + chunk.toString()).slice(
			-LOCAL_STDERR_KEEP,
		);
	});
	child.on("error", (err) => {
		server.stderr += `\n${err.message}`;
	});
	child.unref();
	return server;
}

function whyItDied(server: LocalServer): string {
	const tail = server.stderr.trim().split("\n").slice(-6).join("\n");
	return tail ? `\n${tail}` : "";
}

async function ensureLocalServer(conf: {
	name: string;
	url: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}): Promise<void> {
	if (!conf.command) return;
	const origin = new URL(conf.url).origin;
	if (await reachable(origin)) return;
	let server = started.get(conf.name);
	if (!server || server.child.exitCode !== null) {
		server = startLocalServer({ ...conf, command: conf.command });
		started.set(conf.name, server);
	}
	const deadline = Date.now() + LOCAL_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await reachable(origin)) return;
		if (server.child.exitCode !== null) {
			started.delete(conf.name);
			throw new Error(
				`${conf.name}: its server exited with code ${server.child.exitCode} before ${origin} answered.${whyItDied(server)}`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, LOCAL_POLL_MS));
	}
	throw new Error(
		`${conf.name}: started its server but ${origin} did not answer within ${LOCAL_START_TIMEOUT_MS / 1000}s.${whyItDied(server)}`,
	);
}

export function stopLocalServers(): void {
	for (const [name, server] of started) {
		const { pid } = server.child;
		try {
			if (pid !== undefined) process.kill(-pid, "SIGTERM");
		} catch {
			server.child.kill("SIGTERM");
		}
		started.delete(name);
	}
}

class NeedsAuthError extends Error {
	constructor(server: string, authUrl: string) {
		super(
			`authorization required for "${server}": open ${authUrl} — after approving it will be captured automatically, then run (load-mcp "${server}") again (or run (mcp-authorize "${server}" "<code>"))`,
		);
	}
}

let callbackServer: CallbackServer | undefined;
async function sharedCallbackServer(): Promise<CallbackServer | undefined> {
	if (callbackServer) return callbackServer;
	try {
		callbackServer = await createAuthCallback(
			callbackPort(),
			oauthEnv.LISPTC_OAUTH_REDIRECT_URL,
		);
	} catch {
		return undefined;
	}
	return callbackServer;
}

async function startCallbackCapture(
	serverUrl: string,
	scope: string | undefined,
	authUrl: URL,
	provider: StoredOAuthProvider,
): Promise<void> {
	const cb = await sharedCallbackServer();
	if (!cb) return;
	const state = authUrl.searchParams.get("state") ?? "";
	cb.waitForCode(state, undefined, (code) =>
		auth(provider, { serverUrl, authorizationCode: code, scope }).then(
			() => {},
		),
	).catch(() => {});
}

const clients = new Map<string, Client>();

export const mcpClient: McpClient = {
	connect,
	callTool,
	disconnect,
	login,
	logout,
	authorize,
};

async function connect(
	conf: ConnConfig,
	signal?: AbortSignal,
): Promise<ConnectResult> {
	const client = new Client(
		{ name: "lisptc", version: "1.0.0" },
		{ capabilities: {} },
	);
	try {
		return await openClient(client, conf, signal);
	} catch (e) {
		await client.close().catch(() => {});
		throw e;
	}
}

async function openClient(
	client: Client,
	conf: ConnConfig,
	signal?: AbortSignal,
): Promise<ConnectResult> {
	if ("url" in conf) await ensureLocalServer(conf);
	if ("url" in conf && conf.oauth) {
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
						env: {
							// biome-ignore lint/style/noProcessEnv: the child inherits the whole environment, no value is read here
							...(process.env as Record<string, string>),
							...(conf.env ?? {}),
						},
					});
		await client.connect(transport, { signal });
	}
	const { tools } = await client.listTools(undefined, { signal });
	if (tools.length === 0) {
		await client.close().catch(() => {});
		throw new Error("connected but the server exposed no tools");
	}
	const serverId = randomUUID();
	clients.set(serverId, client);
	return { serverId, tools: tools as Tool[] };
}

async function authorize(conf: HttpConnConfig, code: string): Promise<void> {
	const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
	const provider = await StoredOAuthProvider.create(
		oauthStore,
		conf.url,
		redirectUri(),
		scope,
	);
	const result = await auth(provider, {
		serverUrl: conf.url,
		authorizationCode: code,
		scope,
	});
	if (result !== "AUTHORIZED")
		throw new Error("authorization did not complete (unexpected redirect)");
}

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

async function login(
	conf: HttpConnConfig,
): Promise<{ authUrl: string | null }> {
	await ensureLocalServer(conf);
	const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
	const { authUrl } = await ensureAuthorized(conf.url, scope);
	return { authUrl };
}

async function logout(conf: HttpConnConfig): Promise<void> {
	await oauthStore.clear(new URL(conf.url).origin);
}

function asJsonDocument(text: string): unknown | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return typeof parsed === "object" && parsed !== null ? parsed : undefined;
	} catch {
		return undefined;
	}
}

async function callTool(
	call: ToolCall,
	signal?: AbortSignal,
): Promise<unknown> {
	const client = clients.get(call.serverId);
	if (!client) throw new Error(`no such server: ${call.serverId}`);
	const result = await client.callTool(
		{ name: call.tool, arguments: call.args },
		undefined,
		{ signal },
	);
	if (result.isError) {
		const text = extractText(result.content);
		throw new Error(text || `tool ${call.tool} returned an error`);
	}
	if (result.structuredContent !== undefined) return result.structuredContent;
	const content = result.content;
	if (
		Array.isArray(content) &&
		content.length > 0 &&
		content.every((c) => c?.type === "text")
	) {
		const text = content.map((c) => (c as { text: string }).text).join("\n");
		return asJsonDocument(text) ?? text;
	}
	return content ?? null;
}

async function disconnect(serverId: string): Promise<void> {
	const client = clients.get(serverId);
	if (!client) throw new Error(`no such server: ${serverId}`);
	await client.close();
	clients.delete(serverId);
}

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c?.type === "text")
		.map((c) => c.text)
		.join("\n");
}
