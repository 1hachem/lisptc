import { filePrompt } from "@repo/shared/host-node";
import type { PanelStore } from "./panel.ts";
import type { UiHost } from "./ui.ts";

const uiPrompt = filePrompt(new URL("./ui.ptc", import.meta.url));

export function uiHostFor(options: { panel: PanelStore }): UiHost {
	return { prompt: uiPrompt, panel: options.panel };
}
