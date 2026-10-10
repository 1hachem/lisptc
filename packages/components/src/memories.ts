export interface FiredMemory {
	key: string;
	body: string;
	on?: string;
}

export function firedMemories(value: unknown): FiredMemory[] {
	if (!Array.isArray(value)) return [];
	const fired: FiredMemory[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const raw = entry as Record<string, unknown>;
		const key = raw.key;
		if (typeof key !== "string" || key === "") continue;
		const body = typeof raw.body === "string" ? raw.body : "";
		fired.push(
			typeof raw.on === "string" ? { key, body, on: raw.on } : { key, body },
		);
	}
	return fired;
}
