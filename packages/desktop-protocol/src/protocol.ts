export const PROTOCOL_VERSION = 6;

export const PING_EVERY_MS = 10_000;

export const SILENT_FOR_TOO_LONG_MS = 25_000;

export interface DesktopSettings {
	closeToTray: boolean;
	openAtLogin: boolean;
}

export interface Machine {
	readonly id: string;
	readonly label: string;
}

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
	| {
			type: "open";
			id: string;
			name: string;
			command: string;
			args: readonly string[];
			env: Readonly<Record<string, string>>;
	  }
	| { type: "rpc"; server: string; message: unknown }
	| { type: "close"; name: string }
	| {
			type: "settings";
			id: string;
			change: {
				readonly closeToTray?: boolean;
				readonly openAtLogin?: boolean;
			};
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
