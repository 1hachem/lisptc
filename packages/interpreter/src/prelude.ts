/*
 * The Lisp initialization script, kept as real Lisp source in prelude.ptc
 * (so editors and tooling treat it as Lisp) and loaded at import time.
 */
import { readFileSync } from "node:fs";

export const prelude: string = readFileSync(
	new URL("./prelude.ptc", import.meta.url),
	"utf8",
);
