import { defaultFontId, defaultThemeId, fonts, themes } from "@repo/ui";

export interface StoredChoices {
	theme?: string;
	font?: string;
}

function offered(list: readonly { id: string }[], id: string | undefined) {
	return list.find((candidate) => candidate.id === id)?.id;
}

export function themeOf(stored: StoredChoices | undefined): string {
	return offered(themes, stored?.theme) ?? defaultThemeId;
}

export function fontOf(stored: StoredChoices | undefined): string {
	return offered(fonts, stored?.font) ?? defaultFontId;
}

export function togglesOf<Id extends string>(
	fields: readonly { id: Id }[],
	stored: Readonly<Record<string, boolean>> | undefined,
): Record<Id, boolean> {
	return Object.fromEntries(
		fields.map((field) => [field.id, stored?.[field.id] === true]),
	) as Record<Id, boolean>;
}
