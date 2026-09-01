import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { formatError, log } from "./log.ts";

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof HTTPException) return err.getResponse();

	if (err instanceof ZodError) {
		log.warn(`${c.req.method} ${c.req.path} — ${JSON.stringify(err.issues)}`);
		return c.json({ error: "Validation failed", issues: err.issues }, 400);
	}

	log.error(`${c.req.method} ${c.req.path} failed — ${formatError(err)}`);
	return c.json({ error: "Internal server error" }, 500);
};
