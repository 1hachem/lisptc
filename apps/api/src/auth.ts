import { apiEnv } from "@repo/env/api";
import { Hono } from "hono";

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"content-length",
	"host",
]);

function pass(source: Headers): Headers {
	const headers = new Headers();
	for (const [key, value] of source) {
		if (key.toLowerCase() === "set-cookie") continue;
		if (!HOP_BY_HOP.has(key.toLowerCase())) headers.append(key, value);
	}
	for (const cookie of source.getSetCookie()) {
		headers.append("set-cookie", cookie);
	}
	return headers;
}

export const auth = new Hono();

auth.all("/*", async (c) => {
	const incoming = new URL(c.req.url);
	const target = new URL(
		`/api/auth${incoming.pathname.replace(/^\/api\/auth/, "")}${incoming.search}`,
		apiEnv.CONVEX_SITE_URL,
	);
	const method = c.req.method;
	const upstream = await fetch(target, {
		method,
		headers: pass(c.req.raw.headers),
		body: method === "GET" || method === "HEAD" ? undefined : c.req.raw.body,
		redirect: "manual",
		signal: c.req.raw.signal,
		...({ duplex: "half" } as RequestInit),
	});
	return new Response(upstream.body, {
		status: upstream.status,
		headers: pass(upstream.headers),
	});
});
