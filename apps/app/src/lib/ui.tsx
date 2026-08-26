import { createContext, useContext, useMemo, useState } from "react";

interface UIContextValue {
	navCollapsed: boolean;
	toggleNav: () => void;
	rightOpen: boolean;
	toggleRight: () => void;
	closeRight: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
	const [navCollapsed, setNavCollapsed] = useState(false);
	const [rightOpen, setRightOpen] = useState(false);

	const value = useMemo<UIContextValue>(
		() => ({
			navCollapsed,
			toggleNav: () => setNavCollapsed((c) => !c),
			rightOpen,
			toggleRight: () => setRightOpen((o) => !o),
			closeRight: () => setRightOpen(false),
		}),
		[navCollapsed, rightOpen],
	);

	return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
	const ctx = useContext(UIContext);
	if (!ctx) throw new Error("useUI must be used within UIProvider");
	return ctx;
}
