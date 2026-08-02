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
	) {}

	// Hydrate the provider from the store for the given server + loopback URL.
	static async create(
		store: OAuthStore,
		serverUrl: string,
		redirectUrl: string,
	): Promise<StoredOAuthProvider> {
		const serverKey = new URL(serverUrl).origin;
		const record = (await store.load(serverKey)) ?? {};
		return new StoredOAuthProvider(store, serverKey, redirectUrl, record);
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
