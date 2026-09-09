import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { oauthEnv } from "@repo/env/oauth";

export interface OAuthRecord {
	clientInformation?: OAuthClientInformationFull;
	tokens?: OAuthTokens;
	codeVerifier?: string;
}

export interface OAuthStore {
	load(serverKey: string): Promise<OAuthRecord | undefined>;
	save(serverKey: string, record: OAuthRecord): Promise<void>;
	clear(serverKey: string): Promise<void>;
}

function defaultOAuthDir(): string {
	const dir = process.env.LISPTC_OAUTH_DIR ?? oauthEnv.LISPTC_OAUTH_DIR;
	if (dir) return dir;
	const configHome = oauthEnv.XDG_CONFIG_HOME ?? join(homedir(), ".config");
	return join(configHome, "lisptc", "oauth");
}

function keyToFileName(serverKey: string): string {
	return `${serverKey.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}

export class FileOAuthStore implements OAuthStore {
	constructor(private readonly dir?: string) {}

	private base(): string {
		return this.dir ?? defaultOAuthDir();
	}

	private file(serverKey: string): string {
		return join(this.base(), keyToFileName(serverKey));
	}

	async load(serverKey: string): Promise<OAuthRecord | undefined> {
		try {
			return JSON.parse(await readFile(this.file(serverKey), "utf8"));
		} catch {
			return undefined;
		}
	}

	async save(serverKey: string, record: OAuthRecord): Promise<void> {
		await mkdir(this.base(), { recursive: true, mode: 0o700 });
		await writeFile(this.file(serverKey), JSON.stringify(record), {
			mode: 0o600,
		});
	}

	async clear(serverKey: string): Promise<void> {
		await rm(this.file(serverKey), { force: true });
	}
}

export class StoredOAuthProvider implements OAuthClientProvider {
	authorizationUrl?: URL;
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

const DEFAULT_AUTH_TIMEOUT_MS = 300_000;

type CodeExchange = (code: string) => Promise<void>;

interface Pending {
	resolve: (code: string) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	exchange?: CodeExchange;
}

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string,
	);
}

export class CallbackServer {
	private boundPort = 0;
	private readonly pending = new Map<string, Pending>();

	private constructor(
		private readonly server: Server,
		private readonly path: string,
		private readonly advertised: string | undefined,
	) {}

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
				void cb.handle(url, res);
			});
			const cb = new CallbackServer(server, path, redirectUrl);
			server.once("error", reject);
			server.listen(port, host, () => {
				cb.boundPort = (server.address() as AddressInfo).port;
				resolve(cb);
			});
		});
	}

	private page(res: ServerResponse, status: number, body: string): void {
		res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
		res.end(`<!doctype html><meta charset=utf-8><p>${body}</p>`);
	}

	private async handle(url: URL, res: ServerResponse): Promise<void> {
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state") ?? "";
		const oauthError = url.searchParams.get("error");
		const entry = this.pending.get(state);
		if (!entry) {
			this.page(
				res,
				400,
				"This authorization link is unknown or has expired — start a new login from the REPL and open the latest link.",
			);
			return;
		}
		this.pending.delete(state);
		clearTimeout(entry.timer);
		if (oauthError || !code) {
			const msg = oauthError ?? "the redirect carried no authorization code";
			entry.reject(new Error(`authorization failed: ${msg}`));
			this.page(res, 400, `Authorization failed: ${escapeHtml(msg)}.`);
			return;
		}
		try {
			if (entry.exchange) await entry.exchange(code);
			entry.resolve(code);
			this.page(
				res,
				200,
				"Authorization complete — you can close this tab and return to the REPL.",
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			entry.reject(e instanceof Error ? e : new Error(msg));
			this.page(
				res,
				400,
				`Authorization failed: ${escapeHtml(msg)} — start a new login from the REPL and open the latest link.`,
			);
		}
	}

	waitForCode(
		state: string,
		timeoutMs: number = DEFAULT_AUTH_TIMEOUT_MS,
		exchange?: CodeExchange,
	): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const prev = this.pending.get(state);
			if (prev) {
				clearTimeout(prev.timer);
				prev.reject(new Error("authorization superseded"));
			}
			const timer = setTimeout(() => {
				this.pending.delete(state);
				reject(new Error("authorization timed out"));
			}, timeoutMs);
			this.pending.set(state, { resolve, reject, timer, exchange });
		});
	}

	redirectUrl(): string {
		return this.advertised ?? `http://127.0.0.1:${this.boundPort}${this.path}`;
	}

	close(): Promise<void> {
		for (const p of this.pending.values()) {
			clearTimeout(p.timer);
			p.reject(new Error("callback server closed"));
		}
		this.pending.clear();
		return new Promise((resolve) => this.server.close(() => resolve()));
	}
}

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
