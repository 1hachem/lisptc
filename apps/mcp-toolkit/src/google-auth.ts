import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { googleSheetsEnv } from "@repo/env/mcps/google/sheets";
import { DiskStore, GoogleProvider, OAuthProxy } from "fastmcp/auth";

const GOOGLE_SCOPES = [
	"openid",
	"email",
	"https://www.googleapis.com/auth/spreadsheets",
	"https://www.googleapis.com/auth/drive.file",
	"https://www.googleapis.com/auth/drive.metadata.readonly",
];

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export class GoogleAuthError extends Error {}

export interface GoogleCredentials {
	accessToken: string;
	refreshToken?: string;
}

function stateDir(server: string): string {
	return (
		googleSheetsEnv.LISPTC_MCP_STATE_DIR ?? join(homedir(), ".lisptc", server)
	);
}

interface ServerKeys {
	jwtSigningKey: string;
	encryptionKey: string;
}

function serverKeys(server: string): ServerKeys {
	const file = join(stateDir(server), "keys.json");
	try {
		return JSON.parse(readFileSync(file, "utf8")) as ServerKeys;
	} catch {
		const keys: ServerKeys = {
			jwtSigningKey: randomBytes(32).toString("base64url"),
			encryptionKey: randomBytes(32).toString("base64url"),
		};
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		writeFileSync(file, `${JSON.stringify(keys)}\n`, { mode: 0o600 });
		return keys;
	}
}

class GoogleOfflineProvider extends GoogleProvider {
	protected override createProxy(): OAuthProxy {
		return new OAuthProxy({
			allowedRedirectUriPatterns: this.config.allowedRedirectUriPatterns,
			allowPlainPkce: false,
			baseUrl: this.config.baseUrl,
			consentRequired: this.config.consentRequired ?? true,
			encryptionKey: this.config.encryptionKey,
			extraAuthorizationParams: {
				access_type: "offline",
				prompt: "consent",
			},
			jwtSigningKey: this.config.jwtSigningKey,
			scopes: this.config.scopes ?? this.getDefaultScopes(),
			tokenStorage: this.config.tokenStorage,
			upstreamAuthorizationEndpoint: this.getAuthorizationEndpoint(),
			upstreamClientId: this.config.clientId,
			upstreamClientSecret: this.config.clientSecret,
			upstreamTokenEndpoint: this.getTokenEndpoint(),
		});
	}
}

export function googleProvider(params: {
	server: string;
	baseUrl: string;
}): GoogleProvider {
	const directory = stateDir(params.server);
	const keys = serverKeys(params.server);
	return new GoogleOfflineProvider({
		baseUrl: params.baseUrl,
		clientId: googleSheetsEnv.GOOGLE_CLIENT_ID,
		clientSecret: googleSheetsEnv.GOOGLE_CLIENT_SECRET,
		consentRequired: false,
		encryptionKey: keys.encryptionKey,
		jwtSigningKey: keys.jwtSigningKey,
		scopes: GOOGLE_SCOPES,
		tokenStorage: new DiskStore({ directory: join(directory, "tokens") }),
	});
}

export function credentialsFrom(
	session: Record<string, unknown> | undefined,
): GoogleCredentials {
	const accessToken = session?.accessToken;
	if (typeof accessToken !== "string") {
		throw new GoogleAuthError(
			'Google is not authorized for this session. Reconnect with (load-mcp "sheets") and approve the link it returns.',
		);
	}
	const refreshToken = session?.refreshToken;
	return {
		accessToken,
		refreshToken: typeof refreshToken === "string" ? refreshToken : undefined,
	};
}

async function refreshUpstream(refreshToken: string): Promise<string> {
	const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: googleSheetsEnv.GOOGLE_CLIENT_ID,
			client_secret: googleSheetsEnv.GOOGLE_CLIENT_SECRET,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}).toString(),
	});
	if (!res.ok) {
		throw new GoogleAuthError(
			'Google access expired and could not be renewed. Run (mcp-logout "sheets") then (load-mcp "sheets") to authorize again.',
		);
	}
	const { access_token } = (await res.json()) as { access_token: string };
	return access_token;
}

async function send(
	url: URL | string,
	init: RequestInit,
	token: string,
): Promise<Response> {
	return fetch(url, {
		...init,
		headers: { ...init.headers, Authorization: `Bearer ${token}` },
	});
}

export async function googleJson<T>(
	creds: GoogleCredentials,
	url: URL | string,
	init: RequestInit = {},
): Promise<T> {
	let res = await send(url, init, creds.accessToken);
	if (res.status === 401 && creds.refreshToken) {
		res = await send(url, init, await refreshUpstream(creds.refreshToken));
	}
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Google API error (HTTP ${res.status}): ${text}`);
	}
	return (text ? JSON.parse(text) : {}) as T;
}
