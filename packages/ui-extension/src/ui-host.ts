import { filePrompt } from "@repo/shared/host-node";
import type { PanelStore } from "./panel.ts";
import { MemoryTourStore, type TourStore } from "./tour-store.ts";
import type { UiHost } from "./ui.ts";
import { MemoryViewStore, type ViewStore } from "./view-store.ts";

const uiPrompt = filePrompt(new URL("./ui.ptc", import.meta.url));

export function uiHostFor(options: {
	panel: PanelStore;
	views?: ViewStore;
	tours?: TourStore;
}): UiHost {
	return {
		prompt: uiPrompt,
		panel: options.panel,
		views: options.views ?? new MemoryViewStore(),
		tours: options.tours ?? new MemoryTourStore(),
	};
}
