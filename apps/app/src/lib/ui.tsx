import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { CHANNELS, type ChannelId, channelCookie } from "./channels.ts";
import {
	PANEL_COOKIE,
	readBoolPref,
	SIDEBAR_COOKIE,
	writeBoolPref,
} from "./prefs.ts";

type Shown = Record<ChannelId, boolean>;

function readShown(): Shown {
	return Object.fromEntries(
		CHANNELS.map((c) => [
			c.id,
			readBoolPref(channelCookie(c.id), c.shownByDefault),
		]),
	) as Shown;
}

interface UIContextValue {
	leftOpen: boolean;
	setLeftOpen: (open: boolean) => void;
	toggleLeft: () => void;
	rightOpen: boolean;
	setRightOpen: (open: boolean) => void;
	toggleRight: () => void;
	shown: Shown;
	toggleChannel: (id: ChannelId) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
	const [leftOpen, setLeft] = useState(() =>
		readBoolPref(SIDEBAR_COOKIE, false),
	);
	const [rightOpen, setRight] = useState(() =>
		readBoolPref(PANEL_COOKIE, false),
	);
	const [shown, setShown] = useState<Shown>(readShown);

	const setLeftOpen = useCallback((open: boolean) => {
		setLeft(open);
		writeBoolPref(SIDEBAR_COOKIE, open);
	}, []);

	const setRightOpen = useCallback((open: boolean) => {
		setRight(open);
		writeBoolPref(PANEL_COOKIE, open);
	}, []);

	const toggleChannel = useCallback((id: ChannelId) => {
		setShown((current) => {
			const next = !current[id];
			writeBoolPref(channelCookie(id), next);
			return { ...current, [id]: next };
		});
	}, []);

	const value = useMemo<UIContextValue>(
		() => ({
			leftOpen,
			setLeftOpen,
			toggleLeft: () => setLeftOpen(!leftOpen),
			rightOpen,
			setRightOpen,
			toggleRight: () => setRightOpen(!rightOpen),
			shown,
			toggleChannel,
		}),
		[leftOpen, rightOpen, shown, setLeftOpen, setRightOpen, toggleChannel],
	);

	return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
	const ctx = useContext(UIContext);
	if (!ctx) throw new Error("useUI must be used within UIProvider");
	return ctx;
}
