export type MetaField =
	| "time"
	| "duration"
	| "steps"
	| "input"
	| "cached"
	| "output"
	| "model"
	| "provider";

export const META_FIELDS: {
	id: MetaField;
	label: string;
	shownByDefault: boolean;
}[] = [
	{ id: "time", label: "time", shownByDefault: true },
	{ id: "duration", label: "duration", shownByDefault: true },
	{ id: "steps", label: "steps", shownByDefault: true },
	{ id: "input", label: "input tokens", shownByDefault: false },
	{ id: "cached", label: "cached tokens", shownByDefault: false },
	{ id: "output", label: "output tokens", shownByDefault: false },
	{ id: "model", label: "model", shownByDefault: false },
	{ id: "provider", label: "provider", shownByDefault: false },
];

export function metaCookie(id: MetaField): string {
	return `ui.meta.${id}`;
}
