import type { IncomingMessage } from "node:http";

export class GoogleAuthError extends Error {}

export type GoogleCredentials = {
	accessToken: string;
};

export function bearer(request: IncomingMessage): Promise<GoogleCredentials> {
	const header = request.headers.authorization ?? "";
	const [scheme, accessToken] = header.split(" ");
	if (scheme?.toLowerCase() !== "bearer" || !accessToken)
		return Promise.reject(
			new Response(null, {
				status: 401,
				statusText: "a Google access token is required as a bearer token",
			}),
		);
	return Promise.resolve({ accessToken });
}

export function credentialsFrom(
	session: GoogleCredentials | undefined,
): GoogleCredentials {
	if (!session)
		throw new GoogleAuthError(
			'Google is not authorized for this session. Reconnect with (load-mcp "sheets") and approve the link it returns.',
		);
	return session;
}

export async function googleJson<T>(
	creds: GoogleCredentials,
	url: URL | string,
	init: RequestInit = {},
): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: { ...init.headers, Authorization: `Bearer ${creds.accessToken}` },
	});
	const text = await res.text();
	if (res.status === 401)
		throw new GoogleAuthError(
			'Google refused the access token. Run (logout "sheets") then (load-mcp "sheets") to authorize again.',
		);
	if (!res.ok) {
		throw new Error(`Google API error (HTTP ${res.status}): ${text}`);
	}
	return (text ? JSON.parse(text) : {}) as T;
}
