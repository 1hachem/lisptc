export type ChannelId =
	| "user"
	| "ui"
	| "lisp"
	| "thinking"
	| "memory"
	| "permissions"
	| "errors"
	| "model"
	| "system";

export interface Channel {
	id: ChannelId;
	label: string;
	hint: string;
	dot: string;
	text: string;
	shownByDefault: boolean;
}

export const CHANNELS: Channel[] = [
	{
		id: "user",
		label: "output",
		hint: "what a step printed for you",
		dot: "bg-fg",
		text: "text-dim",
		shownByDefault: true,
	},
	{
		id: "ui",
		label: "ui",
		hint: "widgets a step rendered",
		dot: "bg-aqua",
		text: "text-aqua",
		shownByDefault: true,
	},
	{
		id: "lisp",
		label: "lisp",
		hint: "the forms a step ran, as code rather than as tools at work",
		dot: "bg-green",
		text: "text-green",
		shownByDefault: false,
	},
	{
		id: "thinking",
		label: "thinking",
		hint: "what the model reasoned before it answered",
		dot: "bg-blue",
		text: "text-blue",
		shownByDefault: true,
	},
	{
		id: "memory",
		label: "memories",
		hint: "what a step recalled",
		dot: "bg-orange",
		text: "text-orange",
		shownByDefault: true,
	},
	{
		id: "permissions",
		label: "permissions",
		hint: "what a step asked you to allow",
		dot: "bg-yellow",
		text: "text-yellow",
		shownByDefault: true,
	},
	{
		id: "errors",
		label: "errors",
		hint: "whether a step failed",
		dot: "bg-red",
		text: "text-red",
		shownByDefault: true,
	},
	{
		id: "model",
		label: "model",
		hint: "what the step sent back to the model",
		dot: "bg-purple",
		text: "text-purple",
		shownByDefault: false,
	},
	{
		id: "system",
		label: "system",
		hint: "what the system told the agent between turns",
		dot: "bg-dim",
		text: "text-dim",
		shownByDefault: false,
	},
];

export function channelCookie(id: ChannelId): string {
	return `ui.channel.${id}`;
}
