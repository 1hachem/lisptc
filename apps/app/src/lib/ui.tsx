import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { INPUT_HELPERS, type InputHelper } from "./input-helpers.ts";
import { META_FIELDS, type MetaField } from "./meta-fields.ts";
import { usePreferences, usePutPreferences } from "./preferences.ts";
import {
	PREFERENCES_COOKIE,
	readBoolPref,
	SIDEBAR_COOKIE,
	writeBoolPref,
} from "./prefs.ts";
import { togglesOf } from "./resolved-preferences.ts";

type MetaShown = Record<MetaField, boolean>;

type InputOn = Record<InputHelper, boolean>;

interface UIContextValue {
	leftOpen: boolean;
	setLeftOpen: (open: boolean) => void;
	toggleLeft: () => void;
	rightOpen: boolean;
	setRightOpen: (open: boolean) => void;
	toggleRight: () => void;
	metaShown: MetaShown;
	toggleMeta: (id: MetaField) => void;
	inputOn: InputOn;
	toggleInput: (id: InputHelper) => void;
	sendLabel: string | undefined;
	setSendLabel: (label: string) => void;
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
	const metaShown: MetaShown = useMemo(
		() => togglesOf(META_FIELDS, stored?.metadata),
		[stored?.metadata],
	);
	const inputOn: InputOn = useMemo(
		() => togglesOf(INPUT_HELPERS, stored?.input),
		[stored?.input],
	);

	const sendLabel = stored?.sendLabel;

	const toggleMeta = useCallback(
		(id: MetaField) =>
			put({ metadata: { ...metaShown, [id]: !metaShown[id] } }),
		[metaShown, put],
	);

	const toggleInput = useCallback(
		(id: InputHelper) => put({ input: { ...inputOn, [id]: !inputOn[id] } }),
		[inputOn, put],
	);

	const setSendLabel = useCallback(
		(label: string) => put({ sendLabel: label }),
		[put],
	);

	const value = useMemo<UIContextValue>(
		() => ({
			leftOpen,
			setLeftOpen,
			toggleLeft: () => setLeftOpen(!leftOpen),
			rightOpen,
			setRightOpen,
			toggleRight: () => setRightOpen(!rightOpen),
			metaShown,
			toggleMeta,
			inputOn,
			toggleInput,
			sendLabel,
			setSendLabel,
		}),
		[
			leftOpen,
			rightOpen,
			metaShown,
			setLeftOpen,
			setRightOpen,
			toggleMeta,
			inputOn,
			toggleInput,
			sendLabel,
			setSendLabel,
		],
	);

	return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
	const ctx = useContext(UIContext);
	if (!ctx) throw new Error("useUI must be used within UIProvider");
	return ctx;
}
