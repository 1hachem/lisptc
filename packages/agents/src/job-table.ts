import type { StateCodec } from "@repo/interpreter/lisp";
import {
	arrayToList,
	Cell,
	LispKeyword,
	newLispKeyword,
} from "@repo/interpreter/objects";
import type { JobState, Outcome } from "./ports.ts";

export type JobKind = "agent" | "code";

export interface JobRecord {
	readonly id: string;
	readonly kind: JobKind;
	readonly label: string;
	readonly state: JobState;
	readonly outcome?: Outcome;
}

export interface SpawnedAgent {
	readonly name: string;
	readonly agent: string;
}

const STATES: readonly JobState[] = [
	"queued",
	"running",
	"done",
	"failed",
	"cancelled",
];

export const FINISHED: ReadonlySet<JobState> = new Set([
	"done",
	"failed",
	"cancelled",
]);

function itemsOf(x: unknown): unknown[] {
	const items: unknown[] = [];
	for (let at = x; at instanceof Cell; at = at.cdr) items.push(at.car);
	return items;
}

function plistOf(x: unknown): Map<string, unknown> {
	const items = itemsOf(x);
	const fields = new Map<string, unknown>();
	for (let i = 0; i + 1 < items.length; i += 2) {
		const key = items[i];
		if (key instanceof LispKeyword) fields.set(key.name, items[i + 1]);
	}
	return fields;
}

function text(fields: Map<string, unknown>, key: string): string | undefined {
	const value = fields.get(key);
	return typeof value === "string" ? value : undefined;
}

function word(fields: Map<string, unknown>, key: string): string | undefined {
	const value = fields.get(key);
	return value instanceof LispKeyword ? value.name : undefined;
}

export function jobPlist(record: JobRecord): unknown {
	const { outcome } = record;
	return arrayToList([
		newLispKeyword("id"),
		record.id,
		newLispKeyword("kind"),
		newLispKeyword(record.kind),
		newLispKeyword("label"),
		record.label,
		newLispKeyword("state"),
		newLispKeyword(record.state),
		...(outcome === undefined
			? []
			: "reply" in outcome
				? [newLispKeyword("reply"), outcome.reply]
				: [newLispKeyword("failure"), outcome.failure]),
	]);
}

function recordOf(x: unknown): JobRecord | undefined {
	const fields = plistOf(x);
	const id = text(fields, "id");
	const kind = word(fields, "kind");
	const label = text(fields, "label");
	const state = STATES.find((known) => known === word(fields, "state"));
	if (id === undefined || label === undefined || state === undefined)
		return undefined;
	if (kind !== "agent" && kind !== "code") return undefined;
	const reply = text(fields, "reply");
	const failure = text(fields, "failure");
	const outcome =
		reply !== undefined
			? { reply }
			: failure !== undefined
				? { failure }
				: undefined;
	return outcome === undefined
		? { id, kind, label, state }
		: { id, kind, label, state, outcome };
}

export const jobsCodec: StateCodec<readonly JobRecord[]> = {
	toLisp: (records) => arrayToList(records.map(jobPlist)),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const record = recordOf(item);
			return record === undefined ? [] : [record];
		}),
};

export const spawnedCodec: StateCodec<readonly SpawnedAgent[]> = {
	toLisp: (spawned) =>
		arrayToList(spawned.map(({ name, agent }) => arrayToList([name, agent]))),
	fromLisp: (x) =>
		itemsOf(x).flatMap((item) => {
			const [name, agent] = itemsOf(item);
			return typeof name === "string" && typeof agent === "string"
				? [{ name, agent }]
				: [];
		}),
};
