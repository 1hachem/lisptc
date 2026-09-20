import { filePrompt } from "@repo/shared/host-node";
import { noExcuse, type ProseHost, readsAsProse } from "./prose.ts";

export const proseHost: ProseHost = {
	classify: readsAsProse,
	excuse: noExcuse,
	prompt: filePrompt(new URL("./prose.ptc", import.meta.url)),
};
