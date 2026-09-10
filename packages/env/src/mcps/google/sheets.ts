import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { missing } from "../errors.ts";

export const googleSheetsEnv = createEnv({
	server: {
		GOOGLE_CLIENT_ID: z.string().min(1),
		GOOGLE_CLIENT_SECRET: z.string().min(1),
		LISPTC_SHEETS_PORT: z.coerce.number().int().positive().default(8911),
		LISPTC_SHEETS_URL: z.url().optional(),
		LISPTC_MCP_STATE_DIR: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: missing({
		server: "sheets",
		path: "/mcps/google",
		task: "mcp:sheets",
	}),
});
