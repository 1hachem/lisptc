import { writeSync } from "node:fs";

export type Level = "info" | "warn" | "error";

const STYLE: Record<Level, string> = {
	info: "\x1b[2m",
	warn: "\x1b[33m",
	error: "\x1b[31m",
};

// turbo pipes the task's stdout, and a piped `process.stdout.write` is queued,
// not written: anything still queued when the process dies is lost — which is
// precisely the line that explains why it died. `writeSync` is the only way to
// guarantee delivery, and at this volume it costs nothing.
function emit(fd: number, text: string): void {
	const buf = Buffer.from(text);
	let written = 0;
	while (written < buf.length) {
		try {
			written += writeSync(fd, buf, written);
		} catch (err) {
			// A momentarily full pipe reports EAGAIN and wants a retry; anything
			// else (a closed stdout) is not going to get better.
			if ((err as NodeJS.ErrnoException).code !== "EAGAIN") return;
		}
	}
}

// turbo pipes our stdout, so `isTTY` is false even in an interactive terminal —
// hence FORCE_COLOR, which turbo sets for exactly this reason.
const forced = process.env.FORCE_COLOR;
const color =
	!process.env.NO_COLOR &&
	(forced !== undefined ? forced !== "0" : process.stdout.isTTY === true);

function line(level: Level, msg: string): string {
	const now = new Date();
	const stamp = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, "0")}`;
	const head = `${stamp} ${level.toUpperCase().padEnd(5)}`;
	return `${color ? `${STYLE[level]}${head}\x1b[0m` : head} ${msg}\n`;
}

export const log = {
	info: (msg: string) => emit(1, line("info", msg)),
	warn: (msg: string) => emit(2, line("warn", msg)),
	error: (msg: string) => emit(2, line("error", msg)),
};

/**
 * Render a thrown value for a log line, following `cause` all the way down —
 * undici reports every network failure as a bare `TypeError: fetch failed` and
 * hides the ECONNREFUSED/ENOTFOUND that actually explains it in `cause`.
 */
export function formatError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	let text = err.stack ?? `${err.name}: ${err.message}`;
	let cause: unknown = err.cause;
	while (cause instanceof Error) {
		text += `\ncaused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`;
		cause = cause.cause;
	}
	return text;
}
