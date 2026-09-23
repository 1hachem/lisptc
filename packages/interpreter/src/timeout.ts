import { EvalException } from "./lisp.ts";

export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	what: string,
): Promise<T> {
	if (!Number.isFinite(timeoutMs)) return promise;
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new EvalException(`${what} timed out`, timeoutMs, false)),
				timeoutMs,
			);
			timer.unref?.();
		}),
	]);
}
