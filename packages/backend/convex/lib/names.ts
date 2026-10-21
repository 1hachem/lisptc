const MAX_RENAMES = 100;

export function numbered(name: string, n: number | string): string {
	const dot = name.lastIndexOf(".");
	return dot <= 0
		? `${name} (${n})`
		: `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}

export async function freeName(
	taken: (name: string) => Promise<boolean>,
	name: string,
): Promise<string | null> {
	if (!(await taken(name))) return name;
	for (let n = 2; n <= MAX_RENAMES; n++) {
		const candidate = numbered(name, n);
		if (!(await taken(candidate))) return candidate;
	}
	return null;
}
