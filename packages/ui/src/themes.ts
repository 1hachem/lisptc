export type ThemeScheme = "light" | "dark";

export interface ThemeDef {
	id: string;
	name: string;
	scheme: ThemeScheme;
}

export const themeSchemes: ThemeScheme[] = ["light", "dark"];

export const themes: ThemeDef[] = [
	{
		id: "gruvbox-dark",
		name: "gruvbox",
		scheme: "dark",
	},
	{
		id: "gruvbox-light",
		name: "gruvbox",
		scheme: "light",
	},
	{
		id: "tokyonight-dark",
		name: "tokyonight",
		scheme: "dark",
	},
	{
		id: "tokyonight-light",
		name: "tokyonight",
		scheme: "light",
	},
	{
		id: "borland",
		name: "borland",
		scheme: "dark",
	},
];

export const defaultThemeId = "gruvbox-dark";
