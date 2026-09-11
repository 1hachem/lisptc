export interface FontLink {
	rel: string;
	href: string;
	crossOrigin?: "anonymous";
}

export const fontLinks: FontLink[] = [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300..700;1,400&display=swap",
	},
];
