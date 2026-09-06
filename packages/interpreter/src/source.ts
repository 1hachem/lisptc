import { readFileSync } from "node:fs";

export const LANGUAGE_REFERENCE: string = readFileSync(
	new URL("./SKILL.md", import.meta.url),
	"utf8",
);
