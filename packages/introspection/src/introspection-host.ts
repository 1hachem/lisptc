import { filePrompt } from "@repo/shared/host-node";
import type { IntrospectionHost } from "./introspection.ts";

export const introspectionHost: IntrospectionHost = {
	prompt: filePrompt(new URL("./introspection.ptc", import.meta.url)),
	memories: filePrompt(
		new URL("./introspection.memories.ptc", import.meta.url),
	),
};
