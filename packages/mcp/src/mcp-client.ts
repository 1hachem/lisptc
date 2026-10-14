import { randomUUID } from "node:crypto";
import {
	auth,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { localStateArgs } from "./local-host.ts";
import {
	type CallbackServer,
	issuerClient,
	StoredOAuthProvider,
	sharedAuthCallback,
} from "./mcp-oauth.ts";
import {
	AuthorizationRequired,
	type ConnConfig,
	type ConnectResult,
	type McpClient,
	type McpHost,
	type OAuthClients,
	type OAuthConnConfig,
	type OAuthStore,
	type ServerHandle,
	type Tool,
	type ToolCall,
} from "./ports.ts";

function stdioTransport(
	conf: ConnConfig,
	stateHome: string | undefined,
	scope: string | undefined,
): StdioClientTransport {
	const command = "command" in conf ? conf.command : undefined;
	if (command === undefined)
		throw new Error(
			`${conf.name}: runs as a container image and the host started none`,
		);
	return new StdioClientTransport({
		command,
		args: stateHome
			? localStateArgs(conf, stateHome, scope)
			: (conf.args ?? []),
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
	clients?: OAuthClients;
	scope?: string;
	stateHome?: string;
}

function oauthScope(conf: OAuthConnConfig): string | undefined {
	return conf.scopes?.length ? conf.scopes.join(" ") : undefined;
}

function signsIn(conf: ConnConfig): conf is OAuthConnConfig {
	return "oauth" in conf && Boolean(conf.oauth);
}

function serverKey(conf: OAuthConnConfig, serverUrl: string): string {
	return "image" in conf ? `mcp:${conf.name}` : new URL(serverUrl).origin;
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

	const tokenKey = (key: string): string =>
		ports.scope === undefined ? key : `${ports.scope}/${key}`;

	function providerFor(
		conf: OAuthConnConfig,
		serverUrl: string,
	): Promise<StoredOAuthProvider> {
		const issuer =
			typeof conf.oauth === "object"
				? issuerClient(conf.name, conf.oauth, ports.clients ?? {})
				: undefined;
		return StoredOAuthProvider.open(
			scopedStore,
			serverKey(conf, serverUrl),
			ports.redirectUri,
			oauthScope(conf),
			issuer,
		);
	}

	async function serverUrlOf(conf: OAuthConnConfig): Promise<string> {
		const handle = await ports.host.ensure(conf);
		if (handle) return handle.url;
		if ("url" in conf) return conf.url;
		throw new Error(`${conf.name}: the host started no server to sign in to`);
	}

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
		conf: OAuthConnConfig,
		serverUrl: string,
	): Promise<{
		provider: StoredOAuthProvider;
		authUrl: string | null;
		captured: boolean;
	}> {
		const scope = oauthScope(conf);
		const provider = await providerFor(conf, serverUrl);
		const registered = provider.clientInformation();
		if (
			registered?.redirect_uris &&
			!registered.redirect_uris.includes(ports.redirectUri)
		) {
			await provider.invalidateCredentials("all");
		}
		if (await provider.tokens())
			return { provider, authUrl: null, captured: false };
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

	async function openClient(
		client: Client,
		conf: ConnConfig,
		signal?: AbortSignal,
	): Promise<ConnectResult> {
		const handle: ServerHandle | undefined = await ports.host.ensure(conf);
		if (handle && signsIn(conf)) {
			const { provider, authUrl, captured } = await ensureAuthorized(
				conf,
				handle.url,
			);
			if (authUrl)
				throw new AuthorizationRequired(conf.name, authUrl, captured);
			const transport = new StreamableHTTPClientTransport(new URL(handle.url), {
				authProvider: provider,
			});
			try {
				await client.connect(transport, { signal });
			} catch (e) {
				if (!(e instanceof UnauthorizedError)) throw e;
				await provider.invalidateCredentials("tokens");
				const retry = await ensureAuthorized(conf, handle.url);
				throw new AuthorizationRequired(
					conf.name,
					retry.authUrl ?? handle.url,
					retry.captured,
				);
			}
		} else {
			const transport = handle
				? new StreamableHTTPClientTransport(new URL(handle.url), {
						requestInit: handle.headers
							? { headers: handle.headers }
							: undefined,
					})
				: stdioTransport(conf, ports.stateHome, ports.scope);
			await client.connect(transport, { signal });
		}
		const { tools } = await client.listTools(undefined, { signal });
		if (tools.length === 0) {
			await client.close().catch(() => {});
			throw new Error("connected but the server exposed no tools");
		}
		const serverId = randomUUID();
		clients.set(serverId, { client, name: conf.name });
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
			const entry = clients.get(call.serverId);
			if (!entry) throw new Error(`no such server: ${call.serverId}`);
			ports.host.used(entry.name);
			const result = await entry.client.callTool(
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
			const entry = clients.get(serverId);
			if (!entry) throw new Error(`no such server: ${serverId}`);
			clients.delete(serverId);
			await entry.client.close().catch(() => {});
			await ports.host.stop(entry.name);
		},

		async asleep(serverId: string): Promise<boolean> {
			const entry = clients.get(serverId);
			return entry ? await ports.host.asleep(entry.name) : false;
		},

		async login(conf: OAuthConnConfig): Promise<{ authUrl: string | null }> {
			const { authUrl } = await ensureAuthorized(conf, await serverUrlOf(conf));
			return { authUrl };
		},

		async logout(conf: OAuthConnConfig): Promise<void> {
			await scopedStore.clear(serverKey(conf, "url" in conf ? conf.url : ""));
		},

		async authorize(conf: OAuthConnConfig, code: string): Promise<void> {
			const serverUrl = "url" in conf ? conf.url : await serverUrlOf(conf);
			const provider = await providerFor(conf, serverUrl);
			const result = await auth(provider, {
				serverUrl,
				authorizationCode: code,
				scope: oauthScope(conf),
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
