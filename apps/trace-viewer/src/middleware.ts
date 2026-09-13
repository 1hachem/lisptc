import { traceViewerEnv } from "@repo/env/trace-viewer";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const config = { matcher: "/ingest/:path*" };

const STRIPPED = ["cookie", "accept-encoding"];

export function middleware(request: NextRequest): NextResponse {
	const url = request.nextUrl.clone();
	const upstream = new URL(
		url.pathname.startsWith("/ingest/static")
			? traceViewerEnv.POSTHOG_ASSET_HOST
			: traceViewerEnv.POSTHOG_HOST,
	);

	url.protocol = upstream.protocol;
	url.hostname = upstream.hostname;
	url.port = upstream.port;
	url.pathname = url.pathname.replace(/^\/ingest/, "");

	const headers = new Headers(request.headers);
	headers.set("host", upstream.hostname);
	for (const header of STRIPPED) headers.delete(header);

	return NextResponse.rewrite(url, { request: { headers } });
}
