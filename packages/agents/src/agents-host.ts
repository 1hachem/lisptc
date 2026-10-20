import { filePrompt } from "@repo/shared/host-node";
import type { AgentsHost } from "./agents.ts";

export const agentsHost: AgentsHost = {
	prompt: filePrompt(new URL("./agents.ptc", import.meta.url)),
};
