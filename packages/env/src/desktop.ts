import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const desktopEnv = createEnv({
	server: {
		LISPTC_DESKTOP_URL: z.url().default("https://lisptc.taild4910a.ts.net/"),
		LISPTC_DESKTOP_FALLBACK_URL: z
			.url()
			.default("https://lisptc.taild4910a.ts.net/"),
		APPIMAGE: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
		PLAYWRIGHT_BROWSERS_PATH: z.string().optional(),
		PLAYWRIGHT_MCP_EXECUTABLE_PATH: z.string().optional(),
		PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

const LOCAL_SERVER_KEYS = [
	"PLAYWRIGHT_BROWSERS_PATH",
	"PLAYWRIGHT_MCP_EXECUTABLE_PATH",
	"PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS",
] as const;

export const localServerEnv: Readonly<Record<string, string>> =
	Object.fromEntries(
		LOCAL_SERVER_KEYS.flatMap((key) => {
			const value = desktopEnv[key];
			return value === undefined ? [] : [[key, value]];
		}),
	);
