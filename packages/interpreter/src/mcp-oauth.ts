/*
 * OAuth 2.1 support for remote (HTTP) MCP servers.
 *
 * Remote servers such as Linear speak OAuth 2.1 (PKCE + dynamic client
 * registration + metadata discovery). The MCP SDK implements the whole protocol
 * (`auth()` / the transport's `authProvider`); all we provide is:
 *
 *   1. persistence — where the client registration, tokens and PKCE verifier
 *      live between requests and sessions (so a token, once obtained, is reused
 *      and silently refreshed);
 *   2. redirect capture — grabbing the authorization URL the SDK builds so the
 *      broker can surface it to the user instead of opening a browser here.
 *
 * Persistence is behind the `OAuthStore` interface so the backing store is
 * swappable: a file-backed store ships now; a database-backed one can implement
 * the same interface later without touching the provider or the broker.
 */

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

// Everything persisted for one MCP server's OAuth session.
export interface OAuthRecord {
	// Result of dynamic client registration (client_id, and client_secret for
	// confidential clients).
	clientInformation?: OAuthClientInformationFull;
	// Access + refresh tokens (with expiry). The refresh token is what lets a
	// later session reconnect without sending the user through the browser again.
	tokens?: OAuthTokens;
	// PKCE code verifier, kept only for the brief window between building the
	// authorization URL and exchanging the returned code.
	codeVerifier?: string;
}

// Swappable persistence for OAuth records, keyed by a stable per-server key
// (the server origin). Async so a database-backed implementation fits the same
// shape as the file-backed one.
export interface OAuthStore {
	load(serverKey: string): Promise<OAuthRecord | undefined>;
	save(serverKey: string, record: OAuthRecord): Promise<void>;
	clear(serverKey: string): Promise<void>;
}

// Default directory for the file store: $LISPTC_OAUTH_DIR, else
// $XDG_CONFIG_HOME/lisptc/oauth, else ~/.config/lisptc/oauth.
function defaultOAuthDir(): string {
	if (process.env.LISPTC_OAUTH_DIR) return process.env.LISPTC_OAUTH_DIR;
	const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(configHome, "lisptc", "oauth");
}

// Turn a server key (origin URL) into a safe file name.
function keyToFileName(serverKey: string): string {
	return `${serverKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}

// A file-backed OAuthStore: one JSON file per server under a private directory
// (0700 dir, 0600 files). This is the ships-now implementation; swap in a
// database-backed OAuthStore later without changing anything else.
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

// An OAuthClientProvider (the SDK's storage/redirect hook) backed by an
// OAuthStore. The record is hydrated once via `create`, held in memory so the
// SDK's synchronous getters are cheap, and written through to the store on every
// save. Construct one per connection with the chosen loopback redirect URL.
export class StoredOAuthProvider implements OAuthClientProvider {
	// The authorization URL the SDK asks us to send the user to. Captured rather
	// than opened, so the broker can surface it (the `:needs-auth` job state).
	authorizationUrl?: URL;

	private constructor(
		private readonly store: OAuthStore,
		private readonly serverKey: string,
		private readonly redirect: string,
		private readonly record: OAuthRecord,
		private readonly scope: string | undefined,
	) {}

	// Hydrate the provider from the store for the given server + redirect URL.
	// `scope` is the space-separated OAuth scopes to request (e.g. "read write").
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
//
// Where the authorization server redirects after the user approves, and how the
// resulting `code` gets back to the broker. This is a swappable seam like
// `OAuthStore`: a loopback server is the right default for local/desktop use,
// while a cloud deployment (behind a Kubernetes ingress with a real domain)
// uses a fixed public redirect URL and delivers the code out-of-band. Nothing
// here assumes localhost — the strategy is chosen by `createAuthCallback`.

export interface AuthCallback {
	// The redirect_uri to register with the authorization server.
	redirectUrl(): string;
	// Resolve with the authorization code once it arrives, checking it carries
	// the expected OAuth `state`. Rejects on timeout or state mismatch.
	waitForCode(state: string, timeoutMs?: number): Promise<string>;
	// Deliver a code obtained out-of-band — an ingress handler that terminates
	// the public redirect, or the user pasting it via `(mcp-authorize)`. Both
	// strategies accept this; loopback also fills it in automatically.
	submitCode(params: { code: string; state?: string }): void;
	// Release any resources (e.g. stop the loopback server).
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

// Local default: a transient HTTP server bound to 127.0.0.1 on an ephemeral
// port that captures the redirect. Only reachable from a browser on the same
// machine (never the network), and shut down once the code arrives.
export class LoopbackAuthCallback extends BaseAuthCallback {
	private port = 0;

	private constructor(
		private readonly server: Server,
		private readonly path: string,
	) {
		super();
	}

	static start(path = "/callback"): Promise<LoopbackAuthCallback> {
		return new Promise((resolve) => {
			const server = createServer((req, res) => {
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== path) {
					res.writeHead(404).end();
					return;
				}
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state") ?? undefined;
				res.writeHead(200, { "content-type": "text/html" });
				res.end(
					"<!doctype html><p>Authorization complete — you can close this tab.</p>",
				);
				if (code) cb.submitCode({ code, state });
			});
			const cb = new LoopbackAuthCallback(server, path);
			server.listen(0, "127.0.0.1", () => {
				cb.port = (server.address() as AddressInfo).port;
				resolve(cb);
			});
		});
	}

	redirectUrl(): string {
		return `http://127.0.0.1:${this.port}${this.path}`;
	}

	override close(): Promise<void> {
		return new Promise((resolve) => this.server.close(() => resolve()));
	}
}

// Cloud/ingress default: no local server. The redirect points at a real domain
// (your Kubernetes ingress, e.g. https://mcp.example.com/oauth/callback); the
// handler behind that ingress — or the user via `(mcp-authorize)` — delivers
// the code with `submitCode`.
export class ExternalAuthCallback extends BaseAuthCallback {
	constructor(private readonly url: string) {
		super();
	}
	redirectUrl(): string {
		return this.url;
	}
}

// Choose the callback strategy from configuration. Set
// `LISPTC_OAUTH_REDIRECT_URL` to your ingress callback URL for a cloud
// deployment; otherwise a loopback server is started for local use.
export function createAuthCallback(): Promise<AuthCallback> {
	const external = process.env.LISPTC_OAUTH_REDIRECT_URL;
	if (external) return Promise.resolve(new ExternalAuthCallback(external));
	return LoopbackAuthCallback.start();
}
