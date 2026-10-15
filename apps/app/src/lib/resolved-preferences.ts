import { defaultFontId, defaultThemeId, fonts, themes } from "@repo/ui";
import { defaultMotionId, isMotion, type MotionId } from "@repo/ui/motions.ts";

export interface StoredChoices {
	theme?: string;
	font?: string;
	motion?: string;
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

export function motionOf(stored: StoredChoices | undefined): MotionId {
	return isMotion(stored?.motion) ? stored.motion : defaultMotionId;
}

export function togglesOf<Id extends string>(
	fields: readonly { id: Id; shownByDefault: boolean }[],
	stored: Readonly<Record<string, boolean>> | undefined,
): Record<Id, boolean> {
	return Object.fromEntries(
		fields.map((field) => [
			field.id,
			stored?.[field.id] ?? field.shownByDefault,
		]),
	) as Record<Id, boolean>;
}
