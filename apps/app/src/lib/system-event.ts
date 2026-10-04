export interface SystemEventTicket {
	readonly token: string;
	readonly source: string;
	readonly text: string;
}

export function systemEventTicket(
	value: unknown,
): SystemEventTicket | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { token, source, text } = value as Record<string, unknown>;
	return typeof token === "string" &&
		typeof source === "string" &&
		typeof text === "string"
		? { token, source, text }
		: undefined;
}
