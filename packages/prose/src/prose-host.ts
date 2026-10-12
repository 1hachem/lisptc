import { filePrompt } from "@repo/shared/host-node";
import {
	inInlineCode,
	inTableRow,
	type ProseHost,
	readsAsProse,
} from "./ports.ts";

export const proseHost: ProseHost = {
	classifiers: [readsAsProse],
	markup: [inInlineCode, inTableRow],
	prompt: filePrompt(new URL("./prose.ptc", import.meta.url)),
};
