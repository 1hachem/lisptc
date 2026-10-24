export type ChannelId =
	| "user"
	| "results"
	| "ui"
	| "attachments"
	| "lisp"
	| "thinking"
	| "edits"
	| "memory"
	| "asks"
	| "errors"
	| "model"
	| "system";

export interface Channel {
	id: ChannelId;
	label: string;
	hint: string;
	dot: string;
	text: string;
}

export const CHANNELS: Channel[] = [
	{
		id: "user",
		label: "output",
		hint: "what a step printed for you",
		dot: "bg-fg",
		text: "text-dim",
	},
	{
		id: "results",
		label: "results",
		hint: "the value each form returned, as the interpreter printed it",
		dot: "bg-fg",
		text: "text-fg",
	},
	{
		id: "ui",
		label: "ui",
		hint: "widgets a step rendered",
		dot: "bg-aqua",
		text: "text-aqua",
	},
	{
		id: "attachments",
		label: "attachments",
		hint: "files you or the agent attached to a message",
		dot: "bg-blue",
		text: "text-blue",
	},
	{
		id: "lisp",
		label: "lisp",
		hint: "the forms a step ran, as code rather than as tools at work",
		dot: "bg-green",
		text: "text-green",
	},
	{
		id: "thinking",
		label: "thinking",
		hint: "what the model reasoned before it answered",
		dot: "bg-blue",
		text: "text-blue",
	},
	{
		id: "edits",
		label: "edits",
		hint: "what a step was written as, when it ran as something else",
		dot: "bg-yellow",
		text: "text-yellow",
	},
	{
		id: "memory",
		label: "memories",
		hint: "what a step recalled",
		dot: "bg-orange",
		text: "text-orange",
	},
	{
		id: "asks",
		label: "asks",
		hint: "what a step asked of you: an approval, a sign-in",
		dot: "bg-yellow",
		text: "text-yellow",
	},
	{
		id: "errors",
		label: "errors",
		hint: "whether a step failed",
		dot: "bg-red",
		text: "text-red",
	},
	{
		id: "model",
		label: "model",
		hint: "what the step sent back to the model",
		dot: "bg-purple",
		text: "text-purple",
	},
	{
		id: "system",
		label: "system",
		hint: "what the system told the agent between turns",
		dot: "bg-dim",
		text: "text-dim",
	},
];
