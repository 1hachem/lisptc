import { createMiddleware } from "@tanstack/react-start";
import { withLogContext } from "../logs.ts";
import { tracer } from "./tracer.ts";

function clientIp(forwarded: string | null, real: string | null) {
	return forwarded?.split(",")[0]?.trim() || real || undefined;
}

export const telemetry = createMiddleware({ type: "request" }).server(
	({ request, next }) => {
		const header = (name: string) => request.headers.get(name) ?? undefined;
		const ip = clientIp(
			request.headers.get("x-forwarded-for"),
			request.headers.get("x-real-ip"),
		);
		const userAgent = header("user-agent");
		const distinctId =
			header("x-distinct-id") ?? header("x-posthog-distinct-id");
		const sessionId = header("x-posthog-session-id");
		return tracer.withRequest(
			{
				distinctId,
				sessionId,
				properties: {
					$current_url: request.url,
					$request_method: request.method,
					$request_path: new URL(request.url).pathname,
					...(userAgent ? { $user_agent: userAgent } : {}),
					...(ip ? { $ip: ip } : {}),
				},
			},
			() => withLogContext({ distinctId, sessionId }, () => next()),
		);
	},
);
