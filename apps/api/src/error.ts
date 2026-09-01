import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof HTTPException) return err.getResponse();

	if (err instanceof ZodError) {
		return c.json({ error: "Validation failed", issues: err.issues }, 400);
	}

	// The error object, not a string: console prints the `cause` chain with it,
	// and undici hides the real ECONNREFUSED behind a bare "fetch failed".
	console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
	return c.json({ error: "Internal server error" }, 500);
};
