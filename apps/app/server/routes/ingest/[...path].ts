import { analyticsEnv } from "@repo/env/analytics";
import { defineHandler } from "nitro";

const INGESTION_HOST = analyticsEnv.POSTHOG_HOST ?? "https://us.i.posthog.com";
const ASSET_HOST =
	analyticsEnv.POSTHOG_ASSET_HOST ?? "https://us-assets.i.posthog.com";

const PREFIX = "/ingest";

const TIMEOUT_MS = 10_000;

const STRIP_FROM_REQUEST = new Set([
	"host",
	"cookie",
	"content-length",
	"accept-encoding",
	"connection",
	"keep-alive",
	"transfer-encoding",
	"upgrade",
	"te",
	"trailer",
	"proxy-authorization",
	"proxy-authenticate",
]);

const STRIP_FROM_RESPONSE = new Set([
	"content-encoding",
	"content-length",
	"set-cookie",
	"connection",
	"keep-alive",
	"transfer-encoding",
]);

export default defineHandler(async (event) => {
	const path = event.url.pathname.slice(PREFIX.length) || "/";
	const host = path.startsWith("/static/") ? ASSET_HOST : INGESTION_HOST;

	const headers = new Headers();
	for (const [name, value] of event.req.headers) {
		if (!STRIP_FROM_REQUEST.has(name)) headers.set(name, value);
	}
	const ip = event.req.ip;
	if (ip) {
		const forwarded = event.req.headers.get("x-forwarded-for");
		headers.set("x-forwarded-for", forwarded ? `${forwarded}, ${ip}` : ip);
	}

	const method = event.req.method;
	let upstream: Response;
	try {
		upstream = await fetch(`${host}${path}${event.url.search}`, {
			method,
			headers,
			body:
				method === "GET" || method === "HEAD"
					? undefined
					: await event.req.arrayBuffer(),
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		return new Response(null, { status: 502 });
	}

	const responseHeaders = new Headers();
	for (const [name, value] of upstream.headers) {
		if (!STRIP_FROM_RESPONSE.has(name)) responseHeaders.set(name, value);
	}
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
});
