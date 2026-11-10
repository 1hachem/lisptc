import type { DesktopPreferences } from "@repo/shared/desktop";

export const PROTOCOL_VERSION = 7;

export const DESKTOP_USER_AGENT = "salsal-desktop";

export const PING_EVERY_MS = 10_000;

export const SILENT_FOR_TOO_LONG_MS = 25_000;

export interface Machine {
	readonly id: string;
	readonly label: string;
}

export interface CommandServer {
	readonly kind: "command";
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

export interface ImageServer {
	readonly kind: "image";
	readonly name: string;
	readonly launch: {
		image: string;
		exposed: string;
		path: string;
		args: string[];
	};
	readonly app?: {
		image: string;
		args?: string[];
		ports?: { name: string; port: number }[];
		expose?: string[];
	};
	readonly env: Readonly<Record<string, string>>;
}

export type LocalServerSpec = CommandServer | ImageServer;

export type DesktopMessage =
	| { type: "auth"; token: string; version: number; machine: Machine }
	| { type: "ping" }
	| { type: "opened"; id: string; ok: boolean; error?: string }
	| { type: "rpc"; server: string; message: unknown }
	| { type: "exited"; server: string; error?: string }
	| {
			type: "settings";
			id: string;
			closeToTray: boolean;
			openAtLogin: boolean;
	  };

export type ServerMessage =
	| { type: "welcome" }
	| { type: "pong" }
	| { type: "upgrade"; version: number }
	| ({ type: "open"; id: string } & LocalServerSpec)
	| { type: "rpc"; server: string; message: unknown }
	| { type: "close"; name: string }
	| {
			type: "settings";
			id: string;
			change: Partial<DesktopPreferences>;
	  };

export function parseDesktopMessage(text: string): DesktopMessage | undefined {
	try {
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null) return undefined;
		return "type" in value && typeof value.type === "string"
			? (value as DesktopMessage)
			: undefined;
	} catch {
		return undefined;
	}
}
