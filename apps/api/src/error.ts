import { captureException } from "@repo/ai";
import { ConvexError } from "convex/values";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

const REFUSALS: Record<string, 401 | 403> = {
	UNAUTHENTICATED: 401,
	NOT_PROVISIONED: 403,
	FORBIDDEN: 403,
};

function refusal(err: unknown): 401 | 403 | undefined {
	if (!(err instanceof ConvexError)) return undefined;
	const data = err.data as { code?: unknown } | undefined;
	return typeof data?.code === "string" ? REFUSALS[data.code] : undefined;
}

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof HTTPException) {
		if (err.status >= 500)
			captureException(err, {}, { $response_status_code: err.status });
		return err.getResponse();
	}

	const refused = refusal(err);
	if (refused) {
		return c.json(
			{ error: (err as ConvexError<{ code: string }>).data.code },
			refused,
		);
	}

	if (err instanceof ZodError) {
		return c.json({ error: "Validation failed", issues: err.issues }, 400);
	}

	console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
	captureException(err, {}, { $response_status_code: 500 });
	return c.json({ error: "Internal server error" }, 500);
};
