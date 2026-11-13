import type { Eval } from "@repo/interpreter/drive";
import { messageOf } from "@repo/interpreter/errors";
import { record } from "@repo/interpreter/journal";
import type { Interp, State, StateCodec } from "@repo/interpreter/lisp";
import { type Phase, timedEval } from "@repo/interpreter/timed";
import { activityKind } from "@repo/journal-catalog/activity";

const callSeqCodec: StateCodec<number> = {
	toLisp: (n) => BigInt(n),
	fromLisp: (x) => Number(x),
};

export interface Reporter {
	readonly interp: Interp;
	readonly calls: State<number>;
}

export function reporterFor(interp: Interp): Reporter {
	const calls = interp.state(
		"knowledge/calls",
		callSeqCodec,
		0,
		"The number of the last knowledge file read or write, which numbers the activity the user sees.",
	);
	return { interp, calls };
}

export function* reporting<T>(
	{ interp, calls }: Reporter,
	verb: "read" | "write",
	name: string,
	run: () => Eval<T>,
): Eval<T> {
	const n = calls.get() + 1;
	calls.set(n);
	const report = ({ error, ...phase }: Phase): void =>
		record(interp.channels, activityKind, {
			kind: "file",
			icon: verb,
			label: `knowledge · ${verb}`,
			detail: name,
			...phase,
			...(error === undefined ? {} : { error: messageOf(error) }),
			id: `file-${n}`,
		});
	return yield* timedEval(interp.channels.clock, run, report);
}
