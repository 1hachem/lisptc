export type InputHelper = "send" | "lisp";

export type InputGroup = "shows" | "behaves";

export const INPUT_GROUPS: readonly InputGroup[] = ["shows", "behaves"];

export const INPUT_HELPERS: {
	id: InputHelper;
	group: InputGroup;
	label: string;
	hint: string;
}[] = [
	{
		id: "send",
		group: "shows",
		label: "send button",
		hint: "the button that sends, queues or stops; Enter still sends without it",
	},
	{
		id: "lisp",
		group: "behaves",
		label: "lisp",
		hint: "highlight, complete, check and document the lisp you type",
	},
];
