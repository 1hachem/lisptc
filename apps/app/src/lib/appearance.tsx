import { FontDialog, ThemeDialog } from "@repo/components";
import { type FontDef, fonts, type ThemeDef, themes } from "@repo/ui";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import { fontOf, themeOf } from "./resolved-preferences.ts";
import { mostUsedThemes, recordThemeUse } from "./theme-uses.ts";

const SHORTLIST = 6;

interface Appearance {
	theme: ThemeDef;
	shortlist: ThemeDef[];
	chooseTheme: (id: string) => void;
	openThemePicker: () => void;
	font: FontDef;
	chooseFont: (id: string) => void;
	openFontPicker: () => void;
}

const AppearanceContext = createContext<Appearance | null>(null);

function offered<T extends { id: string }>(list: T[], id: string): T {
	const found = list.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`${id} is not offered`);
	return found;
}

export function AppearanceProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [picking, setPicking] = useState<"theme" | "font" | null>(null);
	const stored = usePreferences();
	const put = usePutPreferences();
	const currentTheme = themeOf(stored);
	const currentFont = fontOf(stored);
	const uses = stored?.themeUses;
	const openThemePicker = useCallback(() => setPicking("theme"), []);
	const openFontPicker = useCallback(() => setPicking("font"), []);
	const shortlist = useMemo(
		() => mostUsedThemes(themes, uses ?? {}, SHORTLIST),
		[uses],
	);

	const chooseTheme = (id: string) => {
		if (id === currentTheme) return;
		put({ theme: id, themeUses: recordThemeUse(uses ?? {}, id) });
	};

	const chooseFont = (id: string) => {
		if (id === currentFont) return;
		put({ font: id });
	};

	const closeWhenFalse = (open: boolean) => {
		if (!open) setPicking(null);
	};

	return (
		<AppearanceContext.Provider
			value={{
				theme: offered(themes, currentTheme),
				shortlist,
				chooseTheme,
				openThemePicker,
				font: offered(fonts, currentFont),
				chooseFont,
				openFontPicker,
			}}
		>
			{children}
			<ThemeDialog
				onOpenChange={closeWhenFalse}
				onSelect={chooseTheme}
				open={picking === "theme"}
				themes={themes}
				value={currentTheme}
			/>
			<FontDialog
				fonts={fonts}
				onOpenChange={closeWhenFalse}
				onSelect={chooseFont}
				open={picking === "font"}
				value={currentFont}
			/>
		</AppearanceContext.Provider>
	);
}

export function useAppearance() {
	const ctx = useContext(AppearanceContext);
	if (!ctx) {
		throw new Error("useAppearance must be used within an AppearanceProvider");
	}
	return ctx;
}
