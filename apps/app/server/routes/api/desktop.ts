import { defineWebSocketHandler } from "nitro";
import { authenticate } from "../../desktop/auth.ts";
import { announce, seen, withdraw } from "../../desktop/presence.ts";
import { desktops } from "../../desktop/registry.ts";
import { DesktopSockets } from "../../desktop/sockets.ts";

const SILENCE_SWEEP_MS = 5_000;

const sockets = new DesktopSockets({
	registry: desktops,
	authenticate,
	announce,
	seen,
	withdraw,
	now: Date.now,
});

let sweeping: ReturnType<typeof setInterval> | undefined;

function sweepSilentDesktops(): void {
	if (sweeping !== undefined) return;
	sweeping = setInterval(() => sockets.sweep(), SILENCE_SWEEP_MS);
	sweeping.unref?.();
	for (const signal of ["SIGTERM", "SIGINT"] as const)
		process.once(signal, () => void sockets.closeAll());
}

export default defineWebSocketHandler({
	message(socket, raw) {
		sweepSilentDesktops();
		return sockets.message(socket, raw.text());
	},
	close(socket) {
		sockets.close(socket);
	},
});
