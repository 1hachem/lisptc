export interface ThemeDef {
	id: string;
	name: string;
	swatches: [string, string, string];
}

export const themes: ThemeDef[] = [
	{
		id: "gruvbox-dark",
		name: "gruvbox dark",
		swatches: ["#fe8019", "#b8bb26", "#83a598"],
	},
	{
		id: "gruvbox-light",
		name: "gruvbox light",
		swatches: ["#af3a03", "#79740e", "#076678"],
	},
	{
		id: "tokyonight-dark",
		name: "tokyonight dark",
		swatches: ["#ff9e64", "#9ece6a", "#7aa2f7"],
	},
	{
		id: "tokyonight-light",
		name: "tokyonight light",
		swatches: ["#b15c00", "#587539", "#2e7de9"],
	},
];

export const defaultThemeId = "gruvbox-dark";
