import { readFileSync } from "node:fs";
import type { InterpExtension } from "./lisp.ts";

export interface PromptSection {
	readonly id: string;
	readonly text: string;
}

export function promptSection(id: string, file: URL): PromptSection {
	return { id, text: readFileSync(file, "utf8") };
}

export class Prompts {
	private readonly byId: Map<string, PromptSection> = new Map();

	add(section: PromptSection): void {
		if (this.byId.has(section.id)) return;
		this.byId.set(section.id, section);
	}

	sections(): PromptSection[] {
		return [...this.byId.values()];
	}

	text(): string {
		return this.sections()
			.map((section) => section.text.trimEnd())
			.join("\n\n");
	}
}

export interface PromptedExtension extends InterpExtension {
	readonly prompt: readonly PromptSection[];
}

export function prompted<E extends InterpExtension>(
	extension: E,
	prompt: readonly PromptSection[],
): E & PromptedExtension {
	return Object.assign(extension, { prompt });
}

export function promptOf(extension: InterpExtension): readonly PromptSection[] {
	const carried = (extension as Partial<PromptedExtension>).prompt;
	return Array.isArray(carried) ? carried : [];
}

export function referenceFor(
	core: PromptSection,
	extensions: readonly InterpExtension[],
): string {
	const prompts = new Prompts();
	prompts.add(core);
	for (const extension of extensions)
		for (const section of promptOf(extension)) prompts.add(section);
	return prompts.text();
}
