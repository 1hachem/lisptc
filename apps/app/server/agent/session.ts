import { webEnv } from "@repo/env/web";
import { createMiddleware } from "@tanstack/react-start";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { edge } from "./edge.ts";
import { HttpError } from "./error.ts";

const jwks = createRemoteJWKSet(
	new URL("/api/auth/convex/jwks", webEnv.CONVEX_SITE_URL),
);

export interface Session {
	token: string;
	subject: string;
}

function bearer(header: string | null): string {
	if (header === null || !header.toLowerCase().startsWith("bearer ")) return "";
	return header.slice(7).trim();
}

export async function verifyToken(token: string): Promise<Session | null> {
	const verified = await jwtVerify(token, jwks, {
		issuer: webEnv.CONVEX_SITE_URL,
		audience: "convex",
	}).catch(() => null);
	if (verified === null || typeof verified.payload.sub !== "string")
		return null;
	return { token, subject: verified.payload.sub };
}

const session = createMiddleware({ type: "request" }).server(
	async ({ request, next }) => {
		const token = bearer(request.headers.get("authorization"));
		if (token === "") {
			throw new HttpError(401, "missing bearer token");
		}
		const current = await verifyToken(token);
		if (current === null) {
			throw new HttpError(401, "invalid bearer token");
		}
		return next({ context: { session: current } });
	},
);

export const authed = [...edge, session] as const;

export interface Authed<TBody> {
	request: Request;
	context: { session: Session; body: TBody };
}
