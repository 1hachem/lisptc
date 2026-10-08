import { initTelemetry, withRequestContext } from "@repo/ai";
import type { MiddlewareHandler } from "hono";

function clientIp(forwarded: string | undefined, real: string | undefined) {
	return forwarded?.split(",")[0]?.trim() || real;
}

export function telemetry(): MiddlewareHandler {
	initTelemetry();
	return (c, next) => {
		const ip = clientIp(
			c.req.header("x-forwarded-for"),
			c.req.header("x-real-ip"),
		);
		const userAgent = c.req.header("user-agent");
		return withRequestContext(
			{
				distinctId:
					c.req.header("x-distinct-id") ??
					c.req.header("x-posthog-distinct-id"),
				sessionId: c.req.header("x-posthog-session-id"),
				properties: {
					$current_url: c.req.url,
					$request_method: c.req.method,
					$request_path: c.req.path,
					...(userAgent ? { $user_agent: userAgent } : {}),
					...(ip ? { $ip: ip } : {}),
				},
			},
			next,
		);
	};
}
