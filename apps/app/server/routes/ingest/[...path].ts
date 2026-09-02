/**
 * First-party PostHog proxy.
 *
 * Content blockers match analytics by domain, so `posthog.com` requests made
 * from the browser never leave it. The browser talks to this path on our own
 * origin instead and the server forwards it verbatim — nothing here
 * understands PostHog's ingestion API, which is what keeps it a dumb pipe that
 * does not need updating when that API grows.
 *
 * `/static/*` splits off to the assets CDN: PostHog serves the lazily loaded
 * bundles (session recorder, toolbar, surveys) from a different host than the
 * one that accepts events.
 *
 * The path is the half a blocklist can still learn. Renaming it means renaming
 * this directory and `PROXY_PATH` in `src/lib/analytics.ts` together.
 */

import { analyticsEnv } from "@repo/env/analytics";
import { defineHandler } from "nitro";

const INGESTION_HOST = analyticsEnv.POSTHOG_HOST ?? "https://us.i.posthog.com";
const ASSET_HOST =
	analyticsEnv.POSTHOG_ASSET_HOST ?? "https://us-assets.i.posthog.com";

const PREFIX = "/ingest";

const TIMEOUT_MS = 10_000;

// Hop-by-hop headers describe one connection and must not be relayed onto the
// next. `cookie` is the one that matters here: a same-origin PostHog means the
// browser attaches our cookies to every event, and forwarding them would hand
// a third party whatever session this app grows. `accept-encoding` goes too —
// undici negotiates and decodes its own, so relaying the browser's invites a
// body labelled gzip that is not.
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

// `content-encoding`/`content-length` describe the body undici already decoded
// for us. `set-cookie` would let a third party write first-party cookies.
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
	// PostHog derives geo from the client IP and `$browser`/`$os` from the user
	// agent. The user agent survives the copy above; the IP is ours now, so pass
	// the real one on, keeping any chain a load balancer already built.
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
			// Follow rather than relay a redirect: a `location` pointing at
			// posthog.com is exactly the request the browser cannot make.
			redirect: "follow",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch {
		// Telemetry must never surface as an application error.
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
