import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { FontDialog, ThemeDialog } from "@repo/components";
import { type FontDef, fonts, type ThemeDef, themes } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	readFontPref,
	readThemePref,
	readThemeUsesPref,
	writeFontPref,
	writeThemePref,
	writeThemeUsesPref,
} from "./prefs.ts";
import {
	mostUsedThemes,
	recordThemeUse,
	type ThemeUses,
} from "./theme-uses.ts";

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

function isOffered(
	list: { id: string }[],
	id: string | undefined,
): id is string {
	return list.some((candidate) => candidate.id === id);
}

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
	const [currentTheme, setCurrentTheme] = useState(readThemePref);
	const [currentFont, setCurrentFont] = useState(readFontPref);
	const [uses, setUses] = useState(readThemeUsesPref);
	const openThemePicker = useCallback(() => setPicking("theme"), []);
	const openFontPicker = useCallback(() => setPicking("font"), []);
	const shortlist = useMemo(
		() => mostUsedThemes(themes, uses, SHORTLIST),
		[uses],
	);
	const { data: stored } = useQuery(convexQuery(api.preferences.get, {}));
	const putPreferences = useConvexMutation(api.preferences.put);

	const save = useCallback(
		(preferences: { theme?: string; font?: string; themeUses?: ThemeUses }) =>
			void putPreferences({ preferences }),
		[putPreferences],
	);

	useEffect(() => {
		if (stored === undefined) return;
		if (!stored?.theme && !stored?.font) {
			save({
				theme: readThemePref(),
				font: readFontPref(),
				themeUses: readThemeUsesPref(),
			});
			return;
		}
		if (isOffered(themes, stored.theme)) {
			writeThemePref(stored.theme);
			setCurrentTheme(stored.theme);
		}
		if (isOffered(fonts, stored.font)) {
			writeFontPref(stored.font);
			setCurrentFont(stored.font);
		}
		if (stored.themeUses) {
			writeThemeUsesPref(stored.themeUses);
			setUses(stored.themeUses);
		}
	}, [stored, save]);

	const chooseTheme = (id: string) => {
		if (id === currentTheme) return;
		const next = recordThemeUse(uses, id);
		writeThemePref(id);
		writeThemeUsesPref(next);
		setCurrentTheme(id);
		setUses(next);
		save({ theme: id, themeUses: next });
	};

	const chooseFont = (id: string) => {
		if (id === currentFont) return;
		writeFontPref(id);
		setCurrentFont(id);
		save({ font: id });
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
