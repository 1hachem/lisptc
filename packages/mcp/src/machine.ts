import type { UserMachine } from "./ports.ts";

export function cachedMachine(presence: () => Promise<boolean>): UserMachine {
	let connected = false;
	return {
		refresh: async () => {
			connected = await presence().catch(() => false);
			return connected;
		},
		connected: () => connected,
	};
}
