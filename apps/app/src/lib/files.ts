import type { Doc } from "@repo/backend/dataModel";
import { formSpans } from "@repo/shared/lisp-forms";

export interface OpenFile {
	path: string;
	source: string;
	language?: "lisp" | "markdown";
}

function quoted(text: string): string {
	return JSON.stringify(text);
}

export function memorySource(
	memory: Pick<Doc<"memories">, "key" | "body" | "on" | "links">,
): string {
	const lines = [`(memory/remember ${quoted(memory.key)}`, `  ${memory.body}`];
	if (memory.on !== undefined) lines.push(`  :on ${memory.on}`);
	if (memory.links.length > 0)
		lines.push(
			`  :links (${memory.links.map((l) => quoted(l.key)).join(" ")})`,
		);
	return `${lines.join("\n")})`;
}

export function fileContext(file: OpenFile, text: string): string {
	const fence = "```";
	return `about \`${file.path}\`:\n${fence}${file.language ?? "lisp"}\n${file.source}\n${fence}\n\n${text}`;
}

export interface PermissionRule {
	name: string;
	source: string;
	start: number;
	end: number;
}

export function permissionRules(source: string): PermissionRule[] {
	return formSpans(source).map(([start, end]) => {
		const form = source.slice(start, end);
		return {
			name: form
				.slice(1, -1)
				.replace(/^permission\//, "")
				.replace(/\s+/g, " ")
				.trim(),
			source: form,
			start,
			end,
		};
	});
}

export function withoutRule(source: string, rule: PermissionRule): string {
	const before = source.slice(0, rule.start).replace(/[ \t]*$/, "");
	const after = source.slice(rule.end).replace(/^[ \t]*\n?/, "");
	return `${before}${after}`;
}
