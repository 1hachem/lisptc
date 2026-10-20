export type InputHelper = "lisp";

export const INPUT_HELPERS: {
	id: InputHelper;
	label: string;
	hint: string;
	shownByDefault: boolean;
}[] = [
	{
		id: "lisp",
		label: "lisp",
		hint: "highlight, complete, check and document the lisp you type",
		shownByDefault: true,
	},
];
