import { AsyncLocalStorage } from "node:async_hooks";
import { apiEnv } from "@repo/env/api";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(
	new URL("/api/auth/convex/jwks", apiEnv.CONVEX_SITE_URL),
);

export interface Session {
	token: string;
	subject: string;
}

declare module "hono" {
	interface ContextVariableMap {
		session: Session;
	}
}

const inFlight = new AsyncLocalStorage<Session>();

export function currentSession(): Session {
	const found = inFlight.getStore();
	if (found === undefined) {
		throw new HTTPException(401, { message: "no session on this request" });
	}
	return found;
}

export const session = createMiddleware(async (c, next) => {
	const header = c.req.header("authorization") ?? "";
	const token = header.toLowerCase().startsWith("bearer ")
		? header.slice(7).trim()
		: "";
	if (token === "") {
		throw new HTTPException(401, { message: "missing bearer token" });
	}
	const verified = await jwtVerify(token, jwks, {
		issuer: apiEnv.CONVEX_SITE_URL,
		audience: "convex",
	}).catch(() => null);
	if (verified === null || typeof verified.payload.sub !== "string") {
		throw new HTTPException(401, { message: "invalid bearer token" });
	}
	const current: Session = { token, subject: verified.payload.sub };
	c.set("session", current);
	await inFlight.run(current, next);
});
