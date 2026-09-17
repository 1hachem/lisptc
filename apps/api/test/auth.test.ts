import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const PORT = 9941;
const ORIGIN = `http://127.0.0.1:${PORT}`;

interface Seen {
	method: string;
	url: string;
	cookie?: string;
	body: string;
}

const seen: Seen[] = [];
let server: Server;
let jwks: string;
let sign: (claims: Record<string, unknown>) => Promise<string>;
let fetchApp: (request: Request) => Response | Promise<Response>;

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
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			seen.push({
				method: req.method ?? "",
				url: req.url ?? "",
				cookie: req.headers.cookie,
				body: Buffer.concat(chunks).toString(),
			});
			res.writeHead(302, {
				location: "http://localhost:3000/",
				"set-cookie": ["a=1; Path=/", "b=2; Path=/"],
			});
			res.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(PORT, resolve));

	process.env.APP_URL = "http://localhost:3000";
	process.env.CONVEX_URL = ORIGIN;
	process.env.CONVEX_SITE_URL = ORIGIN;

	const { Hono } = await import("hono");
	const { auth } = await import("../src/auth.ts");
	const { session } = await import("../src/session.ts");
	const { errorHandler } = await import("../src/error.ts");

	const { ConvexError } = await import("convex/values");

	const app = new Hono();
	app.route("/api/auth", auth);
	app.get("/api/refused", () => {
		throw new ConvexError({ code: "FORBIDDEN" });
	});
	app.get("/api/broken", () => {
		throw new Error("something else");
	});
	app.use("/api/guarded", session);
	app.get("/api/guarded", (c) => c.json({ subject: c.get("session").subject }));
	app.onError(errorHandler);
	fetchApp = (request) => app.fetch(request);
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the auth router", () => {
	test("carries a sign-in through to the deployment untouched", async () => {
		const response = await fetchApp(
			new Request("http://api.test/api/auth/sign-in/social?provider=github", {
				method: "POST",
				headers: { "content-type": "application/json", cookie: "sid=abc" },
				body: JSON.stringify({ provider: "github" }),
			}),
		);

		expect(seen.at(-1)).toMatchObject({
			method: "POST",
			url: "/api/auth/sign-in/social?provider=github",
			cookie: "sid=abc",
			body: JSON.stringify({ provider: "github" }),
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("http://localhost:3000/");
		expect(response.headers.getSetCookie()).toEqual([
			"a=1; Path=/",
			"b=2; Path=/",
		]);
	});
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
