export interface LearnedNote {
	what: string;
	text: string;
}

export interface Picked {
	key: string;
	confidence: number;
}

export interface Judgment {
	failed?: string;
	worthKeeping?: number;
	kind?: string;
	kindConfidence?: number;
	candidate?: string;
	covered?: Picked;
	stale?: Picked;
	calibrated?: boolean;
	did: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function picked(value: unknown): Picked | undefined {
	const raw = record(value);
	const key = text(raw?.key);
	if (raw === undefined || key === undefined) return undefined;
	return { key, confidence: number(raw.confidence) ?? 0 };
}

export function learnedNotes(value: unknown): LearnedNote[] {
	if (!Array.isArray(value)) return [];
	const notes: LearnedNote[] = [];
	for (const entry of value) {
		const raw = record(entry);
		const what = text(raw?.what);
		const said = text(raw?.text);
		if (what === undefined || said === undefined) continue;
		notes.push({ what, text: said });
	}
	return notes;
}

export function judgments(value: unknown): Judgment[] {
	if (!Array.isArray(value)) return [];
	const judged: Judgment[] = [];
	for (const entry of value) {
		const raw = record(entry);
		if (raw === undefined) continue;
		judged.push({
			failed: text(raw.failed),
			worthKeeping: number(raw.worthKeeping),
			kind: text(raw.kind),
			kindConfidence: number(raw.kindConfidence),
			candidate: text(raw.candidate),
			covered: picked(raw.covered),
			stale: picked(raw.stale),
			calibrated:
				typeof raw.calibrated === "boolean" ? raw.calibrated : undefined,
			did: Array.isArray(raw.did)
				? raw.did.filter((one): one is string => typeof one === "string")
				: [],
		});
	}
	return judged;
}
