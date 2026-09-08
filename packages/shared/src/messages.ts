export type Role = "system" | "user" | "assistant";

export const ROLES: Role[] = ["system", "user", "assistant"];

export interface ChatMessage {
	role: Role;
	content: string;
}

export function isRole(name: string): name is Role {
	return (ROLES as string[]).includes(name);
}

export function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.join("");
}
