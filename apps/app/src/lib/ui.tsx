import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	DEBUG_COOKIE,
	PANEL_COOKIE,
	readBoolPref,
	SIDEBAR_COOKIE,
	writeBoolPref,
} from "./prefs.ts";

interface UIContextValue {
	leftOpen: boolean;
	setLeftOpen: (open: boolean) => void;
	toggleLeft: () => void;
	rightOpen: boolean;
	setRightOpen: (open: boolean) => void;
	toggleRight: () => void;
	debug: boolean;
	toggleDebug: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
	const [leftOpen, setLeft] = useState(() =>
		readBoolPref(SIDEBAR_COOKIE, false),
	);
	const [rightOpen, setRight] = useState(() =>
		readBoolPref(PANEL_COOKIE, false),
	);
	const [debug, setDebugState] = useState(() =>
		readBoolPref(DEBUG_COOKIE, false),
	);

	const setLeftOpen = useCallback((open: boolean) => {
		setLeft(open);
		writeBoolPref(SIDEBAR_COOKIE, open);
	}, []);

	const setRightOpen = useCallback((open: boolean) => {
		setRight(open);
		writeBoolPref(PANEL_COOKIE, open);
	}, []);

	const setDebug = useCallback((on: boolean) => {
		setDebugState(on);
		writeBoolPref(DEBUG_COOKIE, on);
	}, []);

	const value = useMemo<UIContextValue>(
		() => ({
			leftOpen,
			setLeftOpen,
			toggleLeft: () => setLeftOpen(!leftOpen),
			rightOpen,
			setRightOpen,
			toggleRight: () => setRightOpen(!rightOpen),
			debug,
			toggleDebug: () => {
				setDebug(!debug);
				if (!debug) setRightOpen(true);
			},
		}),
		[leftOpen, rightOpen, debug, setLeftOpen, setRightOpen, setDebug],
	);

	return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
	const ctx = useContext(UIContext);
	if (!ctx) throw new Error("useUI must be used within UIProvider");
	return ctx;
}
