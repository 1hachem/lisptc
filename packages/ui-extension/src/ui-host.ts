import { filePrompt } from "@repo/shared/host-node";
import type { UiHost } from "./ui.ts";

export const uiHost: UiHost = {
	prompt: filePrompt(new URL("./ui.ptc", import.meta.url)),
};
