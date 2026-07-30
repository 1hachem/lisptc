import { readFileSync } from "node:fs";

export const LISP_GRAMMAR: string = readFileSync(
	new URL("./lisptc.gbnf", import.meta.url),
	"utf8",
);
