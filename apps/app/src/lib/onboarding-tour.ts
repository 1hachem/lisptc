import { callOf, type Datum, plainText, readForm } from "./form-reader.ts";

export interface TourStep {
	say: string;
	anchor: string | undefined;
	page: string | undefined;
	waitsForClick: boolean;
}

export interface Tour {
	id: string;
	steps: TourStep[];
}

function unquoted(datum: Datum): Datum {
	if (datum.kind !== "list") return datum;
	const [head, quoted] = datum.items;
	return head?.kind === "symbol" &&
		head.name === "quote" &&
		quoted !== undefined &&
		datum.items.length === 2
		? quoted
		: datum;
}

function stepOf(datum: Datum): TourStep | undefined {
	const step = unquoted(datum);
	if (step.kind !== "list" || step.items.length % 2 !== 0) return undefined;
	const options = new Map<string, string>();
	for (let i = 0; i < step.items.length; i += 2) {
		const key = step.items[i];
		const value = step.items[i + 1];
		if (key?.kind !== "keyword" || value === undefined) return undefined;
		options.set(key.name, plainText(value));
	}
	return {
		say: options.get("say") ?? "",
		anchor: options.get("anchor"),
		page: options.get("page"),
		waitsForClick: options.get("until") === "click",
	};
}

export function tourOf(script: string): Tour | undefined {
	const call = callOf(readForm(script));
	const [id, ...rest] = call?.args ?? [];
	if (call?.head !== "ui/tour" || id?.kind !== "string") return undefined;
	const steps = rest.map(stepOf);
	if (steps.length === 0 || steps.some((step) => step === undefined))
		return undefined;
	return { id: id.value, steps: steps as TourStep[] };
}
