export const DEFAULT_TOGGLES = {
	channels: {
		user: true,
		results: true,
		ui: true,
		attachments: true,
		lisp: false,
		thinking: true,
		edits: true,
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
		attach: true,
		lisp: true,
	},
} as const satisfies Record<
	"channels" | "metadata" | "input",
	Record<string, boolean>
>;

export type Toggles = Record<string, boolean>;

export function withDefaults<
	T extends {
		channels?: Toggles;
		metadata?: Toggles;
		input?: Toggles;
		panelMotion?: boolean;
	},
>(
	stored: T,
): T & {
	channels: Toggles;
	metadata: Toggles;
	input: Toggles;
	panelMotion: boolean;
} {
	return {
		...stored,
		channels: { ...DEFAULT_TOGGLES.channels, ...stored.channels },
		metadata: { ...DEFAULT_TOGGLES.metadata, ...stored.metadata },
		input: { ...DEFAULT_TOGGLES.input, ...stored.input },
		panelMotion: stored.panelMotion ?? true,
	};
}
