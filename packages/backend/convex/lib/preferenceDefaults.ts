export const DEFAULT_TOGGLES = {
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
} as const satisfies Record<"metadata" | "input", Record<string, boolean>>;

export const DEFAULT_SEND_LABEL = "send";

export const DEFAULT_HIDDEN: readonly string[] = ["attachments", "bin"];

export type Toggles = Record<string, boolean>;

export function withDefaults<
	T extends {
		metadata?: Toggles;
		input?: Toggles;
		sendLabel?: string;
		hidden?: string[];
		panelMotion?: boolean;
		traceBesideChat?: boolean;
		traceLink?: boolean;
	},
>(
	stored: T,
): T & {
	metadata: Toggles;
	input: Toggles;
	sendLabel: string;
	hidden: string[];
	panelMotion: boolean;
	traceBesideChat: boolean;
	traceLink: boolean;
} {
	return {
		...stored,
		metadata: { ...DEFAULT_TOGGLES.metadata, ...stored.metadata },
		input: { ...DEFAULT_TOGGLES.input, ...stored.input },
		sendLabel: stored.sendLabel ?? DEFAULT_SEND_LABEL,
		hidden: stored.hidden ?? [...DEFAULT_HIDDEN],
		panelMotion: stored.panelMotion ?? true,
		traceBesideChat: stored.traceBesideChat ?? false,
		traceLink: stored.traceLink ?? true,
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
