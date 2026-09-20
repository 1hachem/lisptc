import { filePrompt } from "@repo/shared/host-node";
import type { PromisesHost } from "./promises.ts";

export const promisesHost: PromisesHost = {
	prompt: filePrompt(new URL("./promises.ptc", import.meta.url)),
};
