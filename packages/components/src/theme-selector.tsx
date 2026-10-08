"use client";

import {
	type FontDef,
	type ThemeDef,
	type ThemeScheme,
	themeSchemes,
} from "@repo/ui";
import type { ComponentProps } from "react";
import { ChoiceDialog } from "./choice-dialog.tsx";

const SCHEME_HEADINGS: Record<ThemeScheme, string> = {
	light: "Light",
	dark: "Dark",
};

const PREVIEW_INKS = [
	"border border-(--bg2) bg-(--bg)",
	"bg-(--fg)",
	"bg-(--orange)",
	"bg-(--green)",
	"bg-(--blue)",
];

export function ThemeSwatches({ theme }: { theme: ThemeDef }) {
	return (
		<span
			aria-hidden
			data-theme={theme.id}
			className="flex flex-none items-center gap-px"
		>
			{PREVIEW_INKS.map((ink) => (
				<span className={`size-2 ${ink}`} key={ink} />
			))}
		</span>
	);
}

export function FontSample({ font }: { font: FontDef }) {
	return (
		<span aria-hidden data-font={font.id} className="flex-none">
			Aa
		</span>
	);
}

export function ThemeDialog({
	themes,
	...picking
}: Omit<ComponentProps<typeof ChoiceDialog>, "groups" | "noun" | "title"> & {
	themes: ThemeDef[];
}) {
	return (
		<ChoiceDialog
			{...picking}
			groups={themeSchemes.map((scheme) => ({
				heading: SCHEME_HEADINGS[scheme],
				choices: themes
					.filter((theme) => theme.scheme === scheme)
					.map((theme) => ({
						id: theme.id,
						name: theme.name,
						keywords: [scheme],
						preview: <ThemeSwatches theme={theme} />,
					})),
			}))}
			noun="theme"
			title="Theme"
		/>
	);
}

export function FontDialog({
	fonts,
	...picking
}: Omit<ComponentProps<typeof ChoiceDialog>, "groups" | "noun" | "title"> & {
	fonts: FontDef[];
}) {
	return (
		<ChoiceDialog
			{...picking}
			groups={[
				{
					choices: fonts.map((font) => ({
						id: font.id,
						name: font.name,
						preview: <FontSample font={font} />,
					})),
				},
			]}
			noun="font"
			title="Font"
		/>
	);
}
