export interface FiredMemory {
	key: string;
	body: string;
}

export function firedMemories(value: unknown): FiredMemory[] {
	if (!Array.isArray(value)) return [];
	const fired: FiredMemory[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as Record<string, unknown>;
		const key = raw.key;
		if (typeof key !== "string" || key === "") continue;
		fired.push({ key, body: typeof raw.body === "string" ? raw.body : "" });
	}
	return fired;
}
