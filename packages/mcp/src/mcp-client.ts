import { randomUUID } from "node:crypto";
import {
	auth,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
	type CallbackServer,
	StoredOAuthProvider,
	sharedAuthCallback,
} from "./mcp-oauth.ts";
import {
	AuthorizationRequired,
	type ConnConfig,
	type ConnectResult,
	type HttpConnConfig,
	type Icon,
	type McpClient,
	type McpHost,
	type McpTransport,
	type OAuthStore,
	type ServerHandle,
	type Tool,
	type ToolCall,
} from "./ports.ts";

function sdkTransport(inner: McpTransport): Transport {
	const outer: Transport = {
		start: () => inner.start(),
		send: (message) => inner.send(message),
		close: () => inner.close(),
	};
	inner.onmessage = (message) => outer.onmessage?.(message as JSONRPCMessage);
	inner.onclose = () => outer.onclose?.();
	inner.onerror = (error) => outer.onerror?.(error);
	return outer;
}

function stdioTransport(conf: ConnConfig): StdioClientTransport {
	const command = "command" in conf ? conf.command : undefined;
	if (command === undefined)
		throw new Error(
			`${conf.name}: runs as a container image and the host started none`,
		);
	return new StdioClientTransport({
		command,
		args: conf.args ?? [],
		env: {
			// biome-ignore lint/style/noProcessEnv: the child inherits the whole environment, no value is read here
			...(process.env as Record<string, string>),
			...(conf.env ?? {}),
		},
	});
}

export interface McpClientPorts {
	host: McpHost;
	oauth: OAuthStore;
	redirectUri: string;
	callbackPort: number;
	scope?: string;
}

function landsOnCallbackPort(url: string, port: number): boolean {
	const { hostname, port: target } = new URL(url);
	const loopback =
		hostname === "127.0.0.1" ||
		hostname === "localhost" ||
		hostname === "[::1]";
	return loopback && (port === 0 || Number(target) === port);
}

export function mcpClient(ports: McpClientPorts): McpClient {
	const clients = new Map<string, { client: Client; name: string }>();

	const tokenKey = (serverUrl: string): string => {
		const origin = new URL(serverUrl).origin;
		return ports.scope === undefined ? origin : `${ports.scope}/${origin}`;
	};

	const scopedStore: OAuthStore = {
		load: (key) => ports.oauth.load(tokenKey(key)),
		save: (key, record) => ports.oauth.save(tokenKey(key), record),
		clear: (key) => ports.oauth.clear(tokenKey(key)),
	};

	function callbackServer(): Promise<CallbackServer | undefined> {
		if (!landsOnCallbackPort(ports.redirectUri, ports.callbackPort))
			return Promise.resolve(undefined);
		return sharedAuthCallback(ports.callbackPort, ports.redirectUri).catch(
			() => undefined,
		);
	}

	async function startCallbackCapture(
		serverUrl: string,
		scope: string | undefined,
		authUrl: URL,
		provider: StoredOAuthProvider,
	): Promise<boolean> {
		const cb = await callbackServer();
		if (!cb) return false;
		const state = authUrl.searchParams.get("state") ?? "";
		cb.waitForCode(state, undefined, (code) =>
			auth(provider, { serverUrl, authorizationCode: code, scope }).then(
				() => {},
			),
		).catch(() => {});
		return true;
	}

	async function ensureAuthorized(
		serverUrl: string,
		scope: string | undefined,
	): Promise<{
		provider: StoredOAuthProvider;
		authUrl: string | null;
		captured: boolean;
	}> {
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
		if (provider.tokens()) return { provider, authUrl: null, captured: false };
		await auth(provider, { serverUrl, scope });
		const authUrl = provider.authorizationUrl;
		if (!authUrl) throw new Error("no authorization URL produced");
		await provider.savePending(serverUrl);
		const captured = await startCallbackCapture(
			serverUrl,
			scope,
			authUrl,
			provider,
		);
		return { provider, authUrl: authUrl.href, captured };
	}

	async function connectAuthorized(
		client: Client,
		name: string,
		url: string,
		scopes: readonly string[] | undefined,
		signal?: AbortSignal,
	): Promise<void> {
		const scope = scopes?.length ? scopes.join(" ") : undefined;
		const { provider, authUrl, captured } = await ensureAuthorized(url, scope);
		if (authUrl) throw new AuthorizationRequired(name, authUrl, captured);
		const transport = new StreamableHTTPClientTransport(new URL(url), {
			authProvider: provider,
		});
		try {
			await client.connect(transport, { signal });
		} catch (e) {
			if (!(e instanceof UnauthorizedError)) throw e;
			await provider.invalidateCredentials("tokens");
			const retry = await ensureAuthorized(url, scope);
			throw new AuthorizationRequired(
				name,
				retry.authUrl ?? url,
				retry.captured,
			);
		}
	}

	function plainTransport(
		conf: ConnConfig,
		handle: ServerHandle | undefined,
	): Transport {
		if (!handle) return stdioTransport(conf);
		if ("transport" in handle) return sdkTransport(handle.transport());
		return new StreamableHTTPClientTransport(new URL(handle.url), {
			requestInit: handle.headers ? { headers: handle.headers } : undefined,
		});
	}

	async function openClient(
		client: Client,
		conf: ConnConfig,
		signal?: AbortSignal,
	): Promise<ConnectResult> {
		const http = "url" in conf ? conf : undefined;
		const handle: ServerHandle | undefined = await ports.host.ensure(conf);
		if (handle && "url" in handle && http?.oauth)
			await connectAuthorized(
				client,
				conf.name,
				handle.url,
				http.scopes,
				signal,
			);
		else await client.connect(plainTransport(conf, handle), { signal });
		const { tools } = await client.listTools(undefined, { signal });
		if (tools.length === 0) {
			await client.close().catch(() => {});
			throw new Error("connected but the server exposed no tools");
		}
		const serverId = randomUUID();
		clients.set(serverId, { client, name: conf.name });
		const icons = client.getServerVersion()?.icons as Icon[] | undefined;
		return {
			serverId,
			tools: tools as Tool[],
			...(icons?.length ? { icons } : {}),
		};
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
			const entry = clients.get(call.serverId);
			if (!entry) throw new Error(`no such server: ${call.serverId}`);
			const result = await entry.client.callTool(
				{ name: call.tool, arguments: call.args },
				undefined,
				call.timeoutMs === undefined
					? { signal }
					: { signal, timeout: call.timeoutMs },
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
			const entry = clients.get(serverId);
			if (!entry) throw new Error(`no such server: ${serverId}`);
			clients.delete(serverId);
			await entry.client.close().catch(() => {});
			await ports.host.stop(entry.name);
		},

		async login(conf: HttpConnConfig): Promise<{ authUrl: string | null }> {
			const handle = await ports.host.ensure(conf);
			const scope = conf.scopes?.length ? conf.scopes.join(" ") : undefined;
			const { authUrl } = await ensureAuthorized(
				handle !== undefined && "url" in handle ? handle.url : conf.url,
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
