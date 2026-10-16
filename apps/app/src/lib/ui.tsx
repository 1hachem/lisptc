import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { CHANNELS, type ChannelId } from "./channels.ts";
import { META_FIELDS, type MetaField } from "./meta-fields.ts";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import {
	PREFERENCES_COOKIE,
	readBoolPref,
	SIDEBAR_COOKIE,
	writeBoolPref,
} from "./prefs.ts";
import { togglesOf } from "./resolved-preferences.ts";

type Shown = Record<ChannelId, boolean>;

type MetaShown = Record<MetaField, boolean>;

interface UIContextValue {
	leftOpen: boolean;
	setLeftOpen: (open: boolean) => void;
	toggleLeft: () => void;
	rightOpen: boolean;
	setRightOpen: (open: boolean) => void;
	toggleRight: () => void;
	shown: Shown;
	toggleChannel: (id: ChannelId) => void;
	metaShown: MetaShown;
	toggleMeta: (id: MetaField) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
	const [leftOpen, setLeft] = useState(() =>
		readBoolPref(SIDEBAR_COOKIE, false),
	);
	const [rightOpen, setRight] = useState(() =>
		readBoolPref(PREFERENCES_COOKIE, false),
	);
	const setLeftOpen = useCallback((open: boolean) => {
		setLeft(open);
		writeBoolPref(SIDEBAR_COOKIE, open);
	}, []);

	const setRightOpen = useCallback((open: boolean) => {
		setRight(open);
		writeBoolPref(PREFERENCES_COOKIE, open);
	}, []);

	const stored = usePreferences();
	const put = usePutPreferences();
	const shown: Shown = useMemo(
		() => togglesOf(CHANNELS, stored?.channels),
		[stored?.channels],
	);
	const metaShown: MetaShown = useMemo(
		() => togglesOf(META_FIELDS, stored?.metadata),
		[stored?.metadata],
	);

	useEffect(() => {
		if (stored === undefined) return;
		if (!stored.channels) put({ channels: togglesOf(CHANNELS, undefined) });
		if (!stored.metadata) put({ metadata: togglesOf(META_FIELDS, undefined) });
	}, [stored, put]);

	const toggleChannel = useCallback(
		(id: ChannelId) => put({ channels: { ...shown, [id]: !shown[id] } }),
		[shown, put],
	);

	const toggleMeta = useCallback(
		(id: MetaField) =>
			put({ metadata: { ...metaShown, [id]: !metaShown[id] } }),
		[metaShown, put],
	);

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
			metaShown,
			toggleMeta,
		}),
		[
			leftOpen,
			rightOpen,
			shown,
			metaShown,
			setLeftOpen,
			setRightOpen,
			toggleChannel,
			toggleMeta,
		],
	);

	return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
	const ctx = useContext(UIContext);
	if (!ctx) throw new Error("useUI must be used within UIProvider");
	return ctx;
}
