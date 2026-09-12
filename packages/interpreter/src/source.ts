import { type PromptSection, promptSection } from "./prompt.ts";

export const CORE_PROMPT: PromptSection = promptSection(
	"core",
	new URL("./SKILL.ptc", import.meta.url),
);
