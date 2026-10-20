import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serve } from "../helpers.ts";

const PORT = 9941;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let server: Server;
let jwks: string;
let sign: (claims: Record<string, unknown>) => Promise<string>;
let fetchApp: (request: Request) => Response | Promise<Response>;
let verifyToken: typeof import("../../server/token.ts").verifyToken;

beforeAll(async () => {
	const { SignJWT, exportJWK, generateKeyPair } = await import("jose");
	const { publicKey, privateKey } = await generateKeyPair("RS256", {
		extractable: true,
	});
	jwks = JSON.stringify({
		keys: [{ ...(await exportJWK(publicKey)), alg: "RS256", kid: "test" }],
	});
	sign = (claims) =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: "RS256", kid: "test" })
			.setIssuer(ORIGIN)
			.setAudience("convex")
			.setIssuedAt()
			.setExpirationTime("5m")
			.sign(privateKey);

	server = createServer((req, res) => {
		if (req.url === "/api/auth/convex/jwks") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(jwks);
			return;
		}
		res.writeHead(404);
		res.end();
	});
	await new Promise<void>((resolve) => server.listen(PORT, resolve));

	process.env.VITE_CONVEX_URL = ORIGIN;
	process.env.VITE_ENVIRONMENT = "dev";
	process.env.VITE_POSTHOG_KEY = "test";
	process.env.VITE_POSTHOG_SURVEY_ID = "test";
	process.env.CONVEX_URL = ORIGIN;
	process.env.CONVEX_SITE_URL = ORIGIN;
	process.env.CONVEX_SELF_HOSTED_ADMIN_KEY = "test-admin-key";

	const { edge } = await import("../../server/agent/edge.ts");
	const { authed } = await import("../../server/agent/session.ts");
	const { ConvexError } = await import("convex/values");
	({ verifyToken } = await import("../../server/token.ts"));

	const routes: Record<string, (request: Request) => Promise<Response>> = {
		"/api/refused": serve({
			middleware: edge,
			handler: () => {
				throw new ConvexError({ code: "FORBIDDEN" });
			},
		}),
		"/api/broken": serve({
			middleware: edge,
			handler: () => {
				throw new Error("something else");
			},
		}),
		"/api/guarded": serve({
			middleware: authed,
			handler: ({ context }) =>
				Response.json({ subject: context.session.subject }),
		}),
	};
	fetchApp = (request) => routes[new URL(request.url).pathname](request);
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the session gate", () => {
	test("refuses a request with no bearer token", async () => {
		const response = await fetchApp(new Request("http://api.test/api/guarded"));
		expect(response.status).toBe(401);
	});

	test("refuses a token this deployment did not sign", async () => {
		const response = await fetchApp(
			new Request("http://api.test/api/guarded", {
				headers: { authorization: "Bearer not.a.token" },
			}),
		);
		expect(response.status).toBe(401);
	});

	test("refuses a token minted for another audience", async () => {
		const { SignJWT, generateKeyPair } = await import("jose");
		const { privateKey } = await generateKeyPair("RS256", {
			extractable: true,
		});
		const foreign = await new SignJWT({ sub: "user-1" })
			.setProtectedHeader({ alg: "RS256", kid: "test" })
			.setIssuer(ORIGIN)
			.setAudience("somewhere-else")
			.setExpirationTime("5m")
			.sign(privateKey);
		const response = await fetchApp(
			new Request("http://api.test/api/guarded", {
				headers: { authorization: `Bearer ${foreign}` },
			}),
		);
		expect(response.status).toBe(401);
	});

	test("hands the verified subject to the route", async () => {
		const token = await sign({ sub: "user-1" });
		const response = await fetchApp(
			new Request("http://api.test/api/guarded", {
				headers: { authorization: `Bearer ${token}` },
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ subject: "user-1" });
	});
});

describe("a refusal from the deployment", () => {
	test("answers 403 rather than a server error", async () => {
		const response = await fetchApp(new Request("http://api.test/api/refused"));
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "FORBIDDEN" });
	});

	test("leaves an unrecognised failure a server error", async () => {
		const response = await fetchApp(new Request("http://api.test/api/broken"));
		expect(response.status).toBe(500);
	});
});

describe("a token left over from another deployment", () => {
	test("reads as forged when no key here signed it", async () => {
		const { SignJWT, generateKeyPair } = await import("jose");
		const { privateKey } = await generateKeyPair("RS256", {
			extractable: true,
		});
		const elsewhere = await new SignJWT({ sub: "user-1" })
			.setProtectedHeader({ alg: "RS256", kid: "wiped" })
			.setIssuer(ORIGIN)
			.setAudience("convex")
			.setExpirationTime("5m")
			.sign(privateKey);
		expect(await verifyToken(elsewhere)).toEqual({
			signed: false,
			forged: true,
		});
	});

	test("reads as signed when this deployment signed it", async () => {
		expect(await verifyToken(await sign({ sub: "user-1" }))).toEqual({
			signed: true,
			subject: "user-1",
		});
	});
});
