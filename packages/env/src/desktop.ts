import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const LOCAL_SERVER_KEYS = [
	"PLAYWRIGHT_BROWSERS_PATH",
	"PLAYWRIGHT_MCP_EXECUTABLE_PATH",
	"PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS",
	"DISPLAY",
	"WAYLAND_DISPLAY",
	"XDG_RUNTIME_DIR",
	"XAUTHORITY",
	"DBUS_SESSION_BUS_ADDRESS",
	"TMPDIR",
] as const;

type LocalServerKey = (typeof LOCAL_SERVER_KEYS)[number];

const localServerSchema = Object.fromEntries(
	LOCAL_SERVER_KEYS.map((key) => [key, z.string().optional()]),
) as Record<LocalServerKey, z.ZodOptional<z.ZodString>>;

export const desktopEnv = createEnv({
	server: {
		LISPTC_DESKTOP_URL: z.url().default("https://salsal.xyz/"),
		LISPTC_DESKTOP_FALLBACK_URL: z.url().default("https://salsal.xyz/"),
		APPIMAGE: z.string().optional(),
		XDG_CONFIG_HOME: z.string().optional(),
		...localServerSchema,
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

export const localServerEnv: Readonly<Record<string, string>> =
	Object.fromEntries(
		LOCAL_SERVER_KEYS.flatMap((key) => {
			const value = desktopEnv[key];
			return value === undefined ? [] : [[key, value]];
		}),
	);
