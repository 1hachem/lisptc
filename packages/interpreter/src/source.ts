import { readFileSync } from "node:fs";

export const LANGUAGE_REFERENCE: string = readFileSync(
	new URL("./SKILL.ptc", import.meta.url),
	"utf8",
);
