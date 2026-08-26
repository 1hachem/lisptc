/**
 * The single shipped theme. Colors live in `styles/theme.css` keyed by the same
 * `id` (as `[data-theme="<id>"]`). `swatches` are the three preview chips
 * (orange / green / blue).
 */
export interface ThemeDef {
	id: string;
	name: string;
	swatches: [string, string, string];
}

export const themes: ThemeDef[] = [
	{
		id: "gruvbox",
		name: "gruvbox",
		swatches: ["#fe8019", "#b8bb26", "#83a598"],
	},
];

export const defaultThemeId = "gruvbox";
