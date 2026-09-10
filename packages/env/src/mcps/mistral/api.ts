import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { missing } from "../errors.ts";

export const mistralApiEnv = createEnv({
	server: {
		MISTRAL_API_KEY: z.string().min(1),
		MISTRAL_BASE_URL: z.url().default("https://api.mistral.ai/v1"),
		MISTRAL_OCR_MODEL: z.string().min(1).default("mistral-ocr-latest"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: missing({
		server: "ocr",
		path: "/mcps/mistral",
		task: "mcp:ocr",
	}),
});
