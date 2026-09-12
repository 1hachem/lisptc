import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { invalid } from "./errors.ts";

const r2Env = createEnv({
	server: {
		R2_ACCOUNT_ID: z.string().optional(),
		R2_ACCESS_KEY_ID: z.string().optional(),
		R2_SECRET_ACCESS_KEY: z.string().optional(),
		R2_BUCKET: z.string().optional(),
		R2_ENDPOINT: z.url().optional(),
		R2_EVALS_PREFIX: z.string().default("evals/"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: invalid("R2"),
});

export interface R2Config {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	prefix: string;
}

function folder(prefix: string): string {
	const trimmed = prefix.replace(/^\/+|\/+$/g, "");
	return trimmed === "" ? "" : `${trimmed}/`;
}

export function r2Config(): R2Config | undefined {
	const endpoint =
		r2Env.R2_ENDPOINT ??
		(r2Env.R2_ACCOUNT_ID === undefined
			? undefined
			: `https://${r2Env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
	const named = {
		"R2_ACCOUNT_ID or R2_ENDPOINT": endpoint,
		R2_ACCESS_KEY_ID: r2Env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: r2Env.R2_SECRET_ACCESS_KEY,
		R2_BUCKET: r2Env.R2_BUCKET,
	};
	const absent = Object.entries(named)
		.filter(([, value]) => value === undefined)
		.map(([key]) => key);
	if (absent.length === Object.keys(named).length) return undefined;
	if (
		endpoint !== undefined &&
		r2Env.R2_ACCESS_KEY_ID !== undefined &&
		r2Env.R2_SECRET_ACCESS_KEY !== undefined &&
		r2Env.R2_BUCKET !== undefined
	) {
		return {
			endpoint,
			bucket: r2Env.R2_BUCKET,
			accessKeyId: r2Env.R2_ACCESS_KEY_ID,
			secretAccessKey: r2Env.R2_SECRET_ACCESS_KEY,
			prefix: folder(r2Env.R2_EVALS_PREFIX),
		};
	}
	throw new Error(
		`R2 is half configured: ${absent.join(", ")} not set. The credentials come from Infisical at /assets, so run the task that loads them — or unset the rest to fall back to the filesystem.`,
	);
}
