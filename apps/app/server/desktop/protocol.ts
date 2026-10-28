export const PROTOCOL_VERSION = 4;

export const SILENT_FOR_TOO_LONG_MS = 25_000;

export interface DesktopSettings {
	closeToTray: boolean;
	openAtLogin: boolean;
}

export type DesktopMessage =
	| { type: "auth"; token: string; version: number }
	| { type: "ping" }
	| { type: "opened"; id: string; ok: boolean; error?: string }
	| {
			type: "response";
			id: string;
			status: number;
			headers: Record<string, string>;
	  }
	| { type: "chunk"; id: string; data: string }
	| { type: "end"; id: string }
	| { type: "fail"; id: string; error: string }
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
	| {
			type: "request";
			id: string;
			server: string;
			method: string;
			path: string;
			headers: Record<string, string>;
			body?: string;
	  }
	| { type: "cancel"; id: string }
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
