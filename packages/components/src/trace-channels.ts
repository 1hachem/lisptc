import {
	AiChat02Icon,
	Attachment01Icon,
	Brain02Icon,
	BulbIcon,
	CommandLineIcon,
	DashboardSquare01Icon,
	HelpCircleIcon,
	InformationCircleIcon,
	UserGroupIcon,
	UserIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export type ChannelId =
	| "user"
	| "assistant"
	| "output"
	| "ui"
	| "attachments"
	| "thinking"
	| "memory"
	| "asks"
	| "system"
	| "agents";

export interface Channel {
	id: ChannelId;
	icon: IconSvgElement;
	label: string;
	hint: string;
	text: string;
}

export const CHANNELS: Channel[] = [
	{
		id: "user",
		icon: UserIcon,
		label: "user",
		hint: "what you sent the agent",
		text: "text-fg",
	},
	{
		id: "assistant",
		icon: AiChat02Icon,
		label: "assistant",
		hint: "what the agent wrote: its prose and the code it ran",
		text: "text-blue",
	},
	{
		id: "ui",
		icon: DashboardSquare01Icon,
		label: "ui",
		hint: "widgets a step rendered",
		text: "text-aqua",
	},
	{
		id: "attachments",
		icon: Attachment01Icon,
		label: "attachments",
		hint: "files you or the agent attached to a message",
		text: "text-blue",
	},
	{
		id: "thinking",
		icon: BulbIcon,
		label: "thinking",
		hint: "what the model reasoned before it answered",
		text: "text-blue",
	},
	{
		id: "memory",
		icon: Brain02Icon,
		label: "memories",
		hint: "what a step recalled",
		text: "text-orange",
	},
	{
		id: "asks",
		icon: HelpCircleIcon,
		label: "asks",
		hint: "what a step asked of you: an approval, a sign-in",
		text: "text-yellow",
	},
	{
		id: "output",
		icon: CommandLineIcon,
		label: "output",
		hint: "what the step sent back to the model",
		text: "text-purple",
	},
	{
		id: "system",
		icon: InformationCircleIcon,
		label: "system",
		hint: "what the system told the agent between turns",
		text: "text-dim",
	},
	{
		id: "agents",
		icon: UserGroupIcon,
		label: "agents",
		hint: "what the parent agent and its sub-agents sent each other",
		text: "text-purple",
	},
];

const BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c])) as Record<
	ChannelId,
	Channel
>;

export function channelOf(id: ChannelId): Channel {
	return BY_ID[id];
}

export type Shown = Record<ChannelId, boolean>;

export const EVERY_CHANNEL = Object.fromEntries(
	CHANNELS.map((c) => [c.id, true]),
) as Shown;
