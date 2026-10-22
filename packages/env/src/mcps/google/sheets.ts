import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { missing } from "../errors.ts";

export const googleSheetsEnv = createEnv({
	server: {
		LISPTC_SHEETS_PORT: z.coerce.number().int().positive().default(8911),
		LISPTC_SHEETS_HOST: z.string().min(1).default("localhost"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: missing({
		server: "sheets",
		path: "/mcps/google",
		task: "mcp:sheets",
	}),
});
