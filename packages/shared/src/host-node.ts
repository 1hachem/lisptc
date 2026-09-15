import { readFileSync } from "node:fs";
import type { PromptSource } from "./host.ts";

export function filePrompt(url: URL): PromptSource {
	let text: string | undefined;
	return () => {
		if (text === undefined) text = readFileSync(url, "utf8");
		return text;
	};
}
