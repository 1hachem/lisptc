/*
 * OAuth 2.1 for remote MCP servers: token persistence (`OAuthStore` +
 * `StoredOAuthProvider`) and redirect capture (`AuthCallback`). The MCP SDK
 * implements the protocol itself. See devdocs/oauth.md.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { oauthEnv } from "@repo/env/oauth.ts";

// Everything persisted for one MCP server's OAuth session.
export interface OAuthRecord {
	clientInformation?: OAuthClientInformationFull; // dynamic client registration
	tokens?: OAuthTokens; // access + refresh (with expiry)
	codeVerifier?: string; // PKCE, transient between auth URL and code exchange
}

// Swappable persistence for OAuth records, keyed by server origin. Async so a
// database-backed store fits the same shape as the file one.
export interface OAuthStore {
	load(serverKey: string): Promise<OAuthRecord | undefined>;
	save(serverKey: string, record: OAuthRecord): Promise<void>;
	clear(serverKey: string): Promise<void>;
}

// Default directory for the file store: $LISPTC_OAUTH_DIR, else
// $XDG_CONFIG_HOME/lisptc/oauth, else ~/.config/lisptc/oauth.
function defaultOAuthDir(): string {
	if (oauthEnv.LISPTC_OAUTH_DIR) return oauthEnv.LISPTC_OAUTH_DIR;
	const configHome = oauthEnv.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(configHome, "lisptc", "oauth");
}

// Turn a server key (origin URL) into a safe file name.
function keyToFileName(serverKey: string): string {
	return `${serverKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}

// Default OAuthStore: one 0600 JSON file per server under a 0700 dir.
export class FileOAuthStore implements OAuthStore {
	constructor(private readonly dir: string = defaultOAuthDir()) {}

	private file(serverKey: string): string {
		return join(this.dir, keyToFileName(serverKey));
	}

	async load(serverKey: string): Promise<OAuthRecord | undefined> {
		try {
			return JSON.parse(await readFile(this.file(serverKey), "utf8"));
		} catch {
			return undefined; // missing or unreadable => no stored session yet
		}
	}

	async save(serverKey: string, record: OAuthRecord): Promise<void> {
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		await writeFile(this.file(serverKey), JSON.stringify(record), {
			mode: 0o600,
		});
	}

	async clear(serverKey: string): Promise<void> {
		await rm(this.file(serverKey), { force: true });
	}
}

// The SDK's storage/redirect hook, backed by an OAuthStore: hydrated once, held
// in memory for the SDK's sync getters, written through on every save.
export class StoredOAuthProvider implements OAuthClientProvider {
	// Captured (not opened) so the broker can surface it to the user.
	authorizationUrl?: URL;
	// OAuth `state`, stable per instance. Some servers (PostHog) reject an
	// authorize request without one; the callback validates the returned value.
	private _state?: string;
	state(): string {
		if (!this._state) this._state = randomUUID();
		return this._state;
	}

	private constructor(
		private readonly store: OAuthStore,
		private readonly serverKey: string,
		private readonly redirect: string,
		private readonly record: OAuthRecord,
		private readonly scope: string | undefined,
	) {}

	// Hydrate from the store. `scope` is space-separated (e.g. "read write").
	static async create(
		store: OAuthStore,
		serverUrl: string,
		redirectUrl: string,
		scope?: string,
	): Promise<StoredOAuthProvider> {
		const serverKey = new URL(serverUrl).origin;
		const record = (await store.load(serverKey)) ?? {};
		return new StoredOAuthProvider(
			store,
			serverKey,
			redirectUrl,
			record,
			scope,
		);
	}

	get redirectUrl(): string {
		return this.redirect;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "lisptc",
			redirect_uris: [this.redirect],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			...(this.scope ? { scope: this.scope } : {}),
		};
	}

	clientInformation(): OAuthClientInformationFull | undefined {
		return this.record.clientInformation;
	}

	async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
		this.record.clientInformation = info;
		await this.persist();
	}

	tokens(): OAuthTokens | undefined {
		return this.record.tokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		this.record.tokens = tokens;
		await this.persist();
	}

	codeVerifier(): string {
		if (this.record.codeVerifier === undefined)
			throw new Error("no PKCE code verifier stored");
		return this.record.codeVerifier;
	}

	async saveCodeVerifier(verifier: string): Promise<void> {
		this.record.codeVerifier = verifier;
		await this.persist();
	}

	redirectToAuthorization(authorizationUrl: URL): void {
		this.authorizationUrl = authorizationUrl;
	}

	async invalidateCredentials(
		scope: "all" | "client" | "tokens" | "verifier" | "discovery",
	): Promise<void> {
		if (scope === "all" || scope === "tokens") this.record.tokens = undefined;
		if (scope === "all" || scope === "client")
			this.record.clientInformation = undefined;
		if (scope === "all" || scope === "verifier")
			this.record.codeVerifier = undefined;
		await this.persist();
	}

	private async persist(): Promise<void> {
		await this.store.save(this.serverKey, this.record);
	}
}

// --- Authorization callback --------------------------------------------------
// Captures the redirect and hands the `code` back. See devdocs/oauth.md.

interface AuthCallback {
	redirectUrl(): string; // redirect_uri to register
	waitForCode(state: string, timeoutMs?: number): Promise<string>; // rejects on timeout / state mismatch
	submitCode(params: { code: string; state?: string }): void; // deliver an out-of-band code
	close(): Promise<void>;
}

const DEFAULT_AUTH_TIMEOUT_MS = 300_000; // 5 min for the user to authorize

// Shared waiting logic: a single pending authorization resolved by `submitCode`.
abstract class BaseAuthCallback implements AuthCallback {
	private pending?: {
		state: string;
		resolve: (code: string) => void;
		reject: (err: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	};

	abstract redirectUrl(): string;

	waitForCode(
		state: string,
		timeoutMs: number = DEFAULT_AUTH_TIMEOUT_MS,
	): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending = undefined;
				reject(new Error("authorization timed out"));
			}, timeoutMs);
			this.pending = { state, resolve, reject, timer };
		});
	}

	submitCode({ code, state }: { code: string; state?: string }): void {
		const pending = this.pending;
		if (!pending) return; // nothing waiting (late or duplicate callback)
		this.pending = undefined;
		clearTimeout(pending.timer);
		if (state !== undefined && state !== pending.state) {
			pending.reject(new Error("authorization state mismatch"));
			return;
		}
		pending.resolve(code);
	}

	async close(): Promise<void> {}
}

// An HTTP server that captures the redirect. The same server handles both
// modes; only where it binds and the URL it advertises differ:
//   - local:   bind 127.0.0.1, advertise http://127.0.0.1:<port>/callback
//   - ingress: bind 0.0.0.0 (reachable via the ingress), advertise the public
//              domain URL ($LISPTC_OAUTH_REDIRECT_URL)
// The advertised redirect URL can differ from the bind host:port (the ingress
// bridges the public URL to the pod's 0.0.0.0:<port>).
export class CallbackServer extends BaseAuthCallback {
	private boundPort = 0;

	private constructor(
		private readonly server: Server,
		private readonly path: string,
		private readonly advertised: string | undefined,
	) {
		super();
	}

	// Rejects on EADDRINUSE so the caller can fall back to (mcp-authorize).
	static start(opts: {
		host?: string;
		port?: number;
		path?: string;
		redirectUrl?: string;
	}): Promise<CallbackServer> {
		const {
			host = "127.0.0.1",
			port = 0,
			path = "/callback",
			redirectUrl,
		} = opts;
		return new Promise((resolve, reject) => {
			const server = createServer((req, res) => {
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== path) {
					res.writeHead(404).end();
					return;
				}
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state") ?? undefined;
				res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
				res.end(
					"<!doctype html><meta charset=utf-8><p>Authorization complete — you can close this tab and return to the REPL.</p>",
				);
				if (code) cb.submitCode({ code, state });
			});
			const cb = new CallbackServer(server, path, redirectUrl);
			server.once("error", reject);
			server.listen(port, host, () => {
				cb.boundPort = (server.address() as AddressInfo).port;
				resolve(cb);
			});
		});
	}

	redirectUrl(): string {
		return this.advertised ?? `http://127.0.0.1:${this.boundPort}${this.path}`;
	}

	override close(): Promise<void> {
		return new Promise((resolve) => this.server.close(() => resolve()));
	}
}

// With a public `redirectUrl` (an ingress) bind 0.0.0.0 and advertise it; else
// loopback on 127.0.0.1. The broker passes the URL from the validated env.
export function createAuthCallback(
	port: number,
	redirectUrl?: string,
): Promise<CallbackServer> {
	if (redirectUrl) {
		const path = new URL(redirectUrl).pathname || "/callback";
		return CallbackServer.start({ host: "0.0.0.0", port, path, redirectUrl });
	}
	return CallbackServer.start({ host: "127.0.0.1", port, path: "/callback" });
}
