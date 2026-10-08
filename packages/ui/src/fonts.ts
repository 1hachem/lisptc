export interface FontLink {
	rel: string;
	href: string;
	crossOrigin?: "anonymous";
}

export interface FontDef {
	id: string;
	name: string;
}

export const fonts: FontDef[] = [
	{ id: "jetbrains-mono", name: "JetBrains Mono" },
	{ id: "geist", name: "Geist" },
	{ id: "poppins", name: "Poppins" },
];

export const defaultFontId = "jetbrains-mono";

export const fontLinks: FontLink[] = [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300..700;1,400&family=Geist:wght@300..700&family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap",
	},
];
