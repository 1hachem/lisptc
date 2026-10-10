import { FontDialog, ThemeDialog } from "@repo/components";
import {
	type FontDef,
	fonts,
	type ThemeDef,
	Toaster,
	type ToastPosition,
	themes,
	toast,
} from "@repo/ui";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	readFontPref,
	readThemePref,
	readThemeUsesPref,
	readToastPositionPref,
	writeFontPref,
	writeThemePref,
	writeThemeUsesPref,
	writeToastPositionPref,
} from "./prefs.ts";
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
	toastPosition: ToastPosition;
	chooseToastPosition: (position: ToastPosition) => void;
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
	const [currentTheme, setCurrentTheme] = useState(readThemePref);
	const [currentFont, setCurrentFont] = useState(readFontPref);
	const [uses, setUses] = useState(readThemeUsesPref);
	const [toastPosition, setToastPosition] = useState(readToastPositionPref);
	const openThemePicker = useCallback(() => setPicking("theme"), []);
	const openFontPicker = useCallback(() => setPicking("font"), []);
	const shortlist = useMemo(
		() => mostUsedThemes(themes, uses, SHORTLIST),
		[uses],
	);

	const chooseTheme = (id: string) => {
		if (id === currentTheme) return;
		const next = recordThemeUse(uses, id);
		writeThemePref(id);
		writeThemeUsesPref(next);
		setCurrentTheme(id);
		setUses(next);
	};

	const chooseFont = (id: string) => {
		if (id === currentFont) return;
		writeFontPref(id);
		setCurrentFont(id);
	};

	const chooseToastPosition = (position: ToastPosition) => {
		if (position === toastPosition) return;
		writeToastPositionPref(position);
		setToastPosition(position);
		toast("toasts appear here");
	};

	const closeWhenFalse = (open: boolean) => {
		if (!open) setPicking(null);
	};

	const theme = offered(themes, currentTheme);

	return (
		<AppearanceContext.Provider
			value={{
				theme,
				shortlist,
				chooseTheme,
				openThemePicker,
				font: offered(fonts, currentFont),
				chooseFont,
				openFontPicker,
				toastPosition,
				chooseToastPosition,
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
			<Toaster scheme={theme.scheme} position={toastPosition} />
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
