import { filePrompt } from "@repo/shared/host-node";
import type { RecoveryHost } from "./recovery.ts";

export const recoveryHost: RecoveryHost = {
	prompt: filePrompt(new URL("./recovery.ptc", import.meta.url)),
};
