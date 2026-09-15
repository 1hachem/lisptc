export type ChannelId = "user" | "ui" | "memory" | "model";

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
		label: "views",
		hint: "widgets a step rendered",
		dot: "bg-aqua",
		text: "text-aqua",
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
		id: "model",
		label: "model",
		hint: "what the step sent back to the model",
		dot: "bg-purple",
		text: "text-purple",
		shownByDefault: false,
	},
];

export function channelCookie(id: ChannelId): string {
	return `ui.channel.${id}`;
}
