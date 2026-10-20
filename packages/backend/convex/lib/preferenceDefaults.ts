export const DEFAULT_TOGGLES = {
	channels: {
		user: true,
		results: true,
		ui: true,
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
		lisp: true,
	},
} as const satisfies Record<
	"channels" | "metadata" | "input",
	Record<string, boolean>
>;

type Toggles = Record<string, boolean>;

export function withDefaultToggles<
	T extends { channels?: Toggles; metadata?: Toggles; input?: Toggles },
>(stored: T): T & { channels: Toggles; metadata: Toggles; input: Toggles } {
	return {
		...stored,
		channels: { ...DEFAULT_TOGGLES.channels, ...stored.channels },
		metadata: { ...DEFAULT_TOGGLES.metadata, ...stored.metadata },
		input: { ...DEFAULT_TOGGLES.input, ...stored.input },
	};
}
