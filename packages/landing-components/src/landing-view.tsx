import type { LandingPage } from "@repo/landing";
import { fonts, themes } from "@repo/ui";
import type { CSSProperties } from "react";
import {
	type DirectoryEntry,
	LandingSection,
	type StartHref,
} from "./sections.tsx";

function offered(
	list: readonly { id: string }[],
	id: string | undefined,
): string | undefined {
	return list.some((choice) => choice.id === id) ? id : undefined;
}

export function landingTheme(page: LandingPage): {
	theme?: string;
	font?: string;
	style: CSSProperties;
} {
	const accent = page.theme?.accent;
	return {
		theme: offered(themes, page.theme?.base),
		font: offered(fonts, page.theme?.font),
		style: (accent === undefined ? {} : { "--brand": accent }) as CSSProperties,
	};
}

export function LandingView({
	page,
	start,
	verticals = [],
}: {
	page: LandingPage;
	start: StartHref;
	verticals?: readonly DirectoryEntry[];
}) {
	const { theme, font, style } = landingTheme(page);
	return (
		<main
			data-theme={theme}
			data-font={font}
			style={style}
			className="min-h-screen bg-bg font-mono text-fg"
		>
			{page.sections.map((section, index) => (
				<LandingSection
					// biome-ignore lint/suspicious/noArrayIndexKey: a page's sections are static data with no id, so position is their identity
					key={`${section.type}-${index}`}
					section={section}
					start={start}
					verticals={verticals}
				/>
			))}
		</main>
	);
}
