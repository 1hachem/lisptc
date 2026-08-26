import { createContext, useContext, useMemo, useState } from "react";

interface UIContextValue {
	leftOpen: boolean;
	setLeftOpen: (open: boolean) => void;
	rightOpen: boolean;
	setRightOpen: (open: boolean) => void;
	toggleRight: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
	const [leftOpen, setLeftOpen] = useState(true);
	const [rightOpen, setRightOpen] = useState(false);

	const value = useMemo<UIContextValue>(
		() => ({
			leftOpen,
			setLeftOpen,
			rightOpen,
			setRightOpen,
			toggleRight: () => setRightOpen((o) => !o),
		}),
		[leftOpen, rightOpen],
	);

	return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
	const ctx = useContext(UIContext);
	if (!ctx) throw new Error("useUI must be used within UIProvider");
	return ctx;
}
