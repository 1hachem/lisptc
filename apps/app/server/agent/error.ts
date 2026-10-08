import { captureException } from "@repo/ai";
import { createMiddleware } from "@tanstack/react-start";
import { ConvexError } from "convex/values";
import { ZodError } from "zod";

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

const REFUSALS: Record<string, 401 | 403> = {
	UNAUTHENTICATED: 401,
	NOT_PROVISIONED: 403,
	FORBIDDEN: 403,
};

function refusal(
	err: unknown,
): { code: string; status: 401 | 403 } | undefined {
	if (!(err instanceof ConvexError)) return undefined;
	const data: { code?: unknown } | undefined = err.data;
	if (typeof data?.code !== "string") return undefined;
	const status = REFUSALS[data.code];
	return status === undefined ? undefined : { code: data.code, status };
}

function answer(err: unknown, request: Request): Response {
	if (err instanceof Response) return err;

	if (err instanceof HttpError) {
		if (err.status >= 500)
			captureException(err, {}, { $response_status_code: err.status });
		return Response.json({ error: err.message }, { status: err.status });
	}

	const refused = refusal(err);
	if (refused)
		return Response.json({ error: refused.code }, { status: refused.status });

	if (err instanceof ZodError) {
		return Response.json(
			{ error: "Validation failed", issues: err.issues },
			{ status: 400 },
		);
	}

	const { pathname } = new URL(request.url);
	console.error(`Unhandled error on ${request.method} ${pathname}:`, err);
	captureException(err, {}, { $response_status_code: 500 });
	return Response.json({ error: "Internal server error" }, { status: 500 });
}

export const errors = createMiddleware({ type: "request" }).server(
	async ({ request, next }) => {
		try {
			return await next();
		} catch (err) {
			return answer(err, request);
		}
	},
);
