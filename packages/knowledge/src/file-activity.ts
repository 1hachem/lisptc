import type { ActivityEntry } from "@repo/interpreter/annotations";
import { topic } from "@repo/interpreter/channels";
import type { Eval } from "@repo/interpreter/drive";
import type { Interp, State, StateCodec } from "@repo/interpreter/lisp";
import type { Clock } from "@repo/shared/host";

export const fileActivity = topic<ActivityEntry>("knowledge-activity");

const callSeqCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

export interface Reporter {
	readonly interp: Interp;
	readonly calls: State<number>;
	readonly clock: Clock;
}

export function reporterFor(interp: Interp, clock: Clock): Reporter {
	const calls = interp.state(
		"knowledge/calls",
		callSeqCodec,
		0,
		"The number of the last knowledge file read or write, which numbers the activity the user sees.",
	);
	return { interp, calls, clock };
}

export function* reporting<T>(
	{ interp, calls, clock }: Reporter,
	verb: "read" | "write",
	name: string,
	run: () => Eval<T>,
): Eval<T> {
	const n = calls.get() + 1;
	calls.set(n);
	const startedAt = clock.now();
	const report = (state: ActivityEntry["state"]): void =>
		fileActivity.emit(interp.channels, {
			user: {
				kind: "file",
				label: `knowledge · ${verb}`,
				detail: name,
				state,
				id: `file-${n}`,
				startedAt,
				...(state === "started" ? {} : { ms: clock.now() - startedAt }),
			},
		});
	report("started");
	try {
		const value = yield* run();
		report("done");
		return value;
	} catch (error) {
		report("failed");
		throw error;
	}
}
