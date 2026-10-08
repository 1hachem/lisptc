import type { ThemeDef } from "@repo/ui";

export type ThemeUses = Record<string, number>;

export function parseThemeUses(raw: string | undefined): ThemeUses {
	const uses: ThemeUses = {};
	for (const pair of raw?.split("|") ?? []) {
		const [id, count] = pair.split(":");
		const n = Number(count);
		if (id && Number.isInteger(n) && n > 0) uses[id] = n;
	}
	return uses;
}

export function serializeThemeUses(uses: ThemeUses): string {
	return Object.entries(uses)
		.map(([id, count]) => `${id}:${count}`)
		.join("|");
}

export function recordThemeUse(uses: ThemeUses, id: string): ThemeUses {
	return { ...uses, [id]: (uses[id] ?? 0) + 1 };
}

export function mostUsedThemes(
	themes: ThemeDef[],
	uses: ThemeUses,
	limit: number,
): ThemeDef[] {
	return themes
		.map((theme, order) => ({ theme, order, count: uses[theme.id] ?? 0 }))
		.sort((a, b) => b.count - a.count || a.order - b.order)
		.slice(0, limit)
		.map(({ theme }) => theme);
}
