import type { ThemeDef } from "@repo/ui";

export type ThemeUses = Record<string, number>;

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

export function darkVariant(
	themes: readonly ThemeDef[],
	current: ThemeDef,
): ThemeDef | string {
	if (current.scheme === "dark") return `${current.name} is already dark`;
	return (
		themes.find(
			(theme) => theme.name === current.name && theme.scheme === "dark",
		) ?? `${current.name} has no dark variant`
	);
}
