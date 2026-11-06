import { systemClock } from "@repo/shared/host";
import { filePrompt } from "@repo/shared/host-node";
import type { IntentHost } from "./intent.ts";

export const intentHost: IntentHost = {
	prompt: filePrompt(new URL("./intent.ptc", import.meta.url)),
	clock: systemClock,
};
