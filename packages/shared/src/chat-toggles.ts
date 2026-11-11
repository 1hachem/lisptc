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
}[] = [
	{ id: "time", label: "time" },
	{ id: "duration", label: "duration" },
	{ id: "steps", label: "steps" },
	{ id: "input", label: "input tokens" },
	{ id: "cached", label: "cached tokens" },
	{ id: "output", label: "output tokens" },
	{ id: "model", label: "model" },
	{ id: "provider", label: "provider" },
];

export type InputHelper = "attach" | "lisp";

export const INPUT_HELPERS: {
	id: InputHelper;
	label: string;
	hint: string;
}[] = [
	{
		id: "attach",
		label: "attach button",
		hint: "the button that attaches files; dropping or /attachment still works",
	},
	{
		id: "lisp",
		label: "lisp",
		hint: "highlight, complete, check and document the lisp you type",
	},
];
