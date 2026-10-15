import { EvalException } from "./errors.ts";

export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	what: string,
	stillRunning?: () => string | undefined,
): Promise<T> {
	if (!Number.isFinite(timeoutMs)) return promise;
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(timedOut(what, timeoutMs, stillRunning?.())),
				timeoutMs,
			);
			timer.unref?.();
		}),
	]);
}

function timedOut(
	what: string,
	timeoutMs: number,
	note: string | undefined,
): EvalException {
	if (note === undefined)
		return new EvalException(`${what} timed out`, timeoutMs, false);
	return new EvalException(
		`${what} timed out after ${timeoutMs / 1000}s while the work kept running`,
		`${note}. It goes on by itself, so await the same promise again to keep waiting`,
		false,
	);
}
