import { fontLinks } from "@repo/ui/fonts.ts";
import { defaultThemeId } from "@repo/ui/themes.ts";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "dashi-codes",
	description: "What production runs, what it never touches, and what changed",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html data-theme={defaultThemeId} lang="en">
			<head>
				{fontLinks.map((link) => (
					<link key={`${link.rel}-${link.href}`} {...link} />
				))}
			</head>
			<body>{children}</body>
		</html>
	);
}
