import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { CHANNELS, type ChannelId, channelCookie } from "./channels.ts";
import { META_FIELDS, type MetaField, metaCookie } from "./meta-fields.ts";
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

type MetaShown = Record<MetaField, boolean>;

function readMetaShown(): MetaShown {
	return Object.fromEntries(
		META_FIELDS.map((f) => [
			f.id,
			readBoolPref(metaCookie(f.id), f.shownByDefault),
		]),
	) as MetaShown;
}

function adopted<K extends string>(
	current: Record<K, boolean>,
	stored: Record<string, boolean>,
	cookie: (id: K) => string,
): Record<K, boolean> {
	const next = { ...current };
	for (const id of Object.keys(current) as K[]) {
		const value = stored[id];
		if (value === undefined) continue;
		next[id] = value;
		writeBoolPref(cookie(id), value);
	}
	return next;
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
	metaShown: MetaShown;
	toggleMeta: (id: MetaField) => void;
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
	const [metaShown, setMetaShown] = useState<MetaShown>(readMetaShown);

	const setLeftOpen = useCallback((open: boolean) => {
		setLeft(open);
		writeBoolPref(SIDEBAR_COOKIE, open);
	}, []);

	const setRightOpen = useCallback((open: boolean) => {
		setRight(open);
		writeBoolPref(PANEL_COOKIE, open);
	}, []);

	const { data: stored } = useQuery(convexQuery(api.preferences.get, {}));
	const putPreferences = useConvexMutation(api.preferences.put);

	useEffect(() => {
		if (stored === undefined) return;
		if (stored?.channels) {
			setShown((current) =>
				adopted(current, stored.channels ?? {}, channelCookie),
			);
		} else {
			void putPreferences({ preferences: { channels: readShown() } });
		}
		if (stored?.metadata) {
			setMetaShown((current) =>
				adopted(current, stored.metadata ?? {}, metaCookie),
			);
		} else {
			void putPreferences({ preferences: { metadata: readMetaShown() } });
		}
	}, [stored, putPreferences]);

	const toggleChannel = useCallback(
		(id: ChannelId) => {
			const next = { ...shown, [id]: !shown[id] };
			writeBoolPref(channelCookie(id), next[id]);
			setShown(next);
			void putPreferences({ preferences: { channels: next } });
		},
		[shown, putPreferences],
	);

	const toggleMeta = useCallback(
		(id: MetaField) => {
			const next = { ...metaShown, [id]: !metaShown[id] };
			writeBoolPref(metaCookie(id), next[id]);
			setMetaShown(next);
			void putPreferences({ preferences: { metadata: next } });
		},
		[metaShown, putPreferences],
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
