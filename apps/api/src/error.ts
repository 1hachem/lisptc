import { captureException } from "@repo/ai";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof HTTPException) {
		if (err.status >= 500)
			captureException(err, {}, { $response_status_code: err.status });
		return err.getResponse();
	}

	if (err instanceof ZodError) {
		return c.json({ error: "Validation failed", issues: err.issues }, 400);
	}

	console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
	captureException(err, {}, { $response_status_code: 500 });
	return c.json({ error: "Internal server error" }, 500);
};
