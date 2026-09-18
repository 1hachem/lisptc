import { randomUUID } from "node:crypto";
import {
	auth,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	type CallbackServer,
	createAuthCallback,
	StoredOAuthProvider,
} from "./mcp-oauth.ts";
import type {
	ConnConfig,
	ConnectResult,
	HttpConnConfig,
	McpClient,
	McpHost,
	OAuthStore,
	ServerHandle,
	Tool,
	ToolCall,
} from "./ports.ts";

export interface McpClientPorts {
	host: McpHost;
	oauth: OAuthStore;
	redirectUri: string;
	callbackPort: number;
	scope?: string;
}

class NeedsAuthError extends Error {
	constructor(server: string, authUrl: string) {
		super(
			`authorization required for "${server}": open ${authUrl} — after approving it will be captured automatically, then run (load-mcp "${server}") again (or run (mcp-authorize "${server}" "<code>"))`,
		);
	}
}

export function mcpClient(ports: McpClientPorts): McpClient {
	const clients = new Map<string, Client>();
	let callbackServer: CallbackServer | undefined;

	const tokenKey = (serverUrl: string): string => {
		const origin = new URL(serverUrl).origin;
		return ports.scope === undefined ? origin : `${ports.scope}/${origin}`;
	};

	const scopedStore: OAuthStore = {
		load: (key) => ports.oauth.load(tokenKey(key)),
		save: (key, record) => ports.oauth.save(tokenKey(key), record),
		clear: (key) => ports.oauth.clear(tokenKey(key)),
	};

	async function sharedCallbackServer(): Promise<CallbackServer | undefined> {
		if (callbackServer) return callbackServer;
		try {
			callbackServer = await createAuthCallback(
				ports.callbackPort,
				ports.redirectUri,
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

	async function ensureAuthorized(
		serverUrl: string,
		scope: string | undefined,
	): Promise<{ provider: StoredOAuthProvider; authUrl: string | null }> {
		const provider = await StoredOAuthProvider.create(
			scopedStore,
			serverUrl,
			ports.redirectUri,
			scope,
		);
		const registered = provider.clientInformation();
		if (
			registered?.redirect_uris &&
			!registered.redirect_uris.includes(ports.redirectUri)
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

	async function openClient(
		client: Client,
		conf: ConnConfig,
		signal?: AbortSignal,
	): Promise<ConnectResult> {
		const http = "url" in conf ? conf : undefined;
		const handle: ServerHandle | undefined = await ports.host.ensure(conf);
		if (handle && http?.oauth) {
			const scope = http.scopes?.length ? http.scopes.join(" ") : undefined;
			const { provider, authUrl } = await ensureAuthorized(handle.url, scope);
			if (authUrl) throw new NeedsAuthError(conf.name, authUrl);
			const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
				authProvider: provider,
			});
			try {
				await client.connect(transport, { signal });
			} catch (e) {
				if (!(e instanceof UnauthorizedError)) throw e;
				await provider.invalidateCredentials("tokens");
				const retry = await ensureAuthorized(handle.url, scope);
				throw new NeedsAuthError(conf.name, retry.authUrl ?? handle.url);
			}
		} else {
			const transport = handle
				? new StreamableHTTPClientTransport(new URL(handle.url), {
						requestInit: handle.headers
							? { headers: handle.headers }
							: undefined,
					})
				: new StdioClientTransport({
						command: (conf as { command: string }).command,
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

	return {
		async connect(
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
		},

		async callTool(call: ToolCall, signal?: AbortSignal): Promise<unknown> {
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
			if (result.structuredContent !== undefined)
				return result.structuredContent;
			const content = result.content;
			if (
				Array.isArray(content) &&
				content.length > 0 &&
				content.every((c) => c?.type === "text")
			) {
				const text = content
					.map((c) => (c as { text: string }).text)
					.join("\n");
				return asJsonDocument(text) ?? text;
			}
			return content ?? null;
		},

		async disconnect(serverId: string): Promise<void> {
			const client = clients.get(serverId);
			if (!client) throw new Error(`no such server: ${serverId}`);
			await client.close();
			clients.delete(serverId);
		},

		async login(conf: HttpConnConfig): Promise<{ authUrl: string | null }> {
			const handle = await ports.host.ensure(conf);
			const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
			const { authUrl } = await ensureAuthorized(
				handle?.url ?? conf.url,
				scope,
			);
			return { authUrl };
		},

		async logout(conf: HttpConnConfig): Promise<void> {
			await scopedStore.clear(conf.url);
		},

		async authorize(conf: HttpConnConfig, code: string): Promise<void> {
			const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
			const provider = await StoredOAuthProvider.create(
				scopedStore,
				conf.url,
				ports.redirectUri,
				scope,
			);
			const result = await auth(provider, {
				serverUrl: conf.url,
				authorizationCode: code,
				scope,
			});
			if (result !== "AUTHORIZED")
				throw new Error("authorization did not complete (unexpected redirect)");
		},

		async shutdown(): Promise<void> {
			await ports.host.stopAll();
		},
	};
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

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c?.type === "text")
		.map((c) => c.text)
		.join("\n");
}
