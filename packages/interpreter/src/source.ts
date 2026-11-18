import { readFileSync } from "node:fs";

export const LANGUAGE_REFERENCE: string = readFileSync(
	new URL("./core.ptc", import.meta.url),
	"utf8",
);
