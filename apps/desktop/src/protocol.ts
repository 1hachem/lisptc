export const PROTOCOL_VERSION = 3;

export const PING_EVERY_MS = 10_000;

export const SILENT_FOR_TOO_LONG_MS = 25_000;

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
	| { type: "fail"; id: string; error: string };

export type ServerMessage =
	| { type: "welcome" }
	| { type: "pong" }
	| { type: "upgrade"; version: number }
	| {
			type: "open";
			id: string;
			name: string;
			command: string;
			args: string[];
			env: Record<string, string>;
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
	| { type: "close"; name: string };
