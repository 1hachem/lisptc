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
