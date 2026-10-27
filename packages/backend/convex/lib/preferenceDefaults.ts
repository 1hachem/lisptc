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
		attach: true,
		lisp: true,
	},
} as const satisfies Record<"metadata" | "input", Record<string, boolean>>;

export type Toggles = Record<string, boolean>;

export function withDefaults<
	T extends {
		metadata?: Toggles;
		input?: Toggles;
		panelMotion?: boolean;
		traceBesideChat?: boolean;
		traceLink?: boolean;
	},
>(
	stored: T,
): T & {
	metadata: Toggles;
	input: Toggles;
	panelMotion: boolean;
	traceBesideChat: boolean;
	traceLink: boolean;
} {
	return {
		...stored,
		metadata: { ...DEFAULT_TOGGLES.metadata, ...stored.metadata },
		input: { ...DEFAULT_TOGGLES.input, ...stored.input },
		panelMotion: stored.panelMotion ?? true,
		traceBesideChat: stored.traceBesideChat ?? false,
		traceLink: stored.traceLink ?? true,
	};
}
