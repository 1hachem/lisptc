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
