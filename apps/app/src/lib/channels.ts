import {
	AiChat02Icon,
	Alert02Icon,
	ArrowTurnBackwardIcon,
	Attachment01Icon,
	Brain02Icon,
	BulbIcon,
	CommandLineIcon,
	DashboardSquare01Icon,
	HelpCircleIcon,
	InformationCircleIcon,
	SourceCodeIcon,
	UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export type ChannelId =
	| "user"
	| "results"
	| "ui"
	| "attachments"
	| "lisp"
	| "thinking"
	| "memory"
	| "asks"
	| "errors"
	| "model"
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
		icon: CommandLineIcon,
		label: "output",
		hint: "what a step printed for you",
		text: "text-dim",
	},
	{
		id: "results",
		icon: ArrowTurnBackwardIcon,
		label: "results",
		hint: "the value each form returned, as the interpreter printed it",
		text: "text-fg",
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
		id: "lisp",
		icon: SourceCodeIcon,
		label: "lisp",
		hint: "the forms a step ran, as code rather than as tools at work",
		text: "text-green",
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
		id: "errors",
		icon: Alert02Icon,
		label: "errors",
		hint: "whether a step failed",
		text: "text-red",
	},
	{
		id: "model",
		icon: AiChat02Icon,
		label: "model",
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

export type Shown = Record<ChannelId, boolean>;

export const EVERY_CHANNEL = Object.fromEntries(
	CHANNELS.map((c) => [c.id, true]),
) as Shown;
