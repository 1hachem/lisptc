export const DEFAULT_TOGGLES = {
	channels: {
		user: true,
		results: true,
		ui: true,
		attachments: true,
		lisp: false,
		thinking: true,
		memory: true,
		asks: true,
		errors: true,
		model: false,
		system: false,
	},
	metadata: {
		time: true,
		duration: true,
		steps: true,
		input: false,
		cached: false,
		output: false,
		model: false,
		provider: false,
	},
	input: {
		send: true,
		attach: true,
		lisp: true,
	},
} as const satisfies Record<
	"channels" | "metadata" | "input",
	Record<string, boolean>
>;

export const DEFAULT_SEND_LABEL = "send";

export const DEFAULT_HIDDEN: readonly string[] = ["attachments", "bin"];

export type Toggles = Record<string, boolean>;

export function withDefaults<
	T extends {
		channels?: Toggles;
		metadata?: Toggles;
		input?: Toggles;
		sendLabel?: string;
		hidden?: string[];
	},
>(
	stored: T,
): T & {
	channels: Toggles;
	metadata: Toggles;
	input: Toggles;
	sendLabel: string;
	hidden: string[];
} {
	return {
		...stored,
		channels: { ...DEFAULT_TOGGLES.channels, ...stored.channels },
		metadata: { ...DEFAULT_TOGGLES.metadata, ...stored.metadata },
		input: { ...DEFAULT_TOGGLES.input, ...stored.input },
		sendLabel: stored.sendLabel ?? DEFAULT_SEND_LABEL,
		hidden: stored.hidden ?? [...DEFAULT_HIDDEN],
	};
}

const RETIRED_INPUT_TOGGLES: readonly string[] = ["vim"];

export function retiredInputTogglesDropped(
	input: Toggles | undefined,
): { input: Toggles } | undefined {
	if (input === undefined) return undefined;
	const kept = Object.fromEntries(
		Object.entries(input).filter(([id]) => !RETIRED_INPUT_TOGGLES.includes(id)),
	);
	return Object.keys(kept).length === Object.keys(input).length
		? undefined
		: { input: kept };
}
