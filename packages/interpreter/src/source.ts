import { readFileSync } from "node:fs";

export const LANGUAGE_REFERENCE: string = readFileSync(
	new URL("./core.ptc", import.meta.url),
	"utf8",
);

export const LANGUAGE_MEMORIES: string = readFileSync(
	new URL("./lang.memories.ptc", import.meta.url),
	"utf8",
);
