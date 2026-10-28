import { useEffect, useState } from "react";

interface DesktopSettings {
	closeToTray: boolean;
	openAtLogin: boolean;
}

interface DesktopShell {
	settings: () => Promise<DesktopSettings | undefined>;
	updateSettings: (
		change: Partial<DesktopSettings>,
	) => Promise<DesktopSettings | undefined>;
	onSettings?: (listener: (settings: DesktopSettings) => void) => () => void;
}

function shell(): DesktopShell | undefined {
	if (typeof window === "undefined") return undefined;
	return (window as { lisptcDesktop?: DesktopShell }).lisptcDesktop;
}

export function inDesktopShell(): boolean {
	return shell() !== undefined;
}

export function useDesktopSettings() {
	const [settings, setSettings] = useState<DesktopSettings>();
	useEffect(() => {
		void shell()?.settings().then(setSettings);
		return shell()?.onSettings?.(setSettings);
	}, []);
	const update = (change: Partial<DesktopSettings>) => {
		void shell()?.updateSettings(change).then(setSettings);
	};
	return { settings, update };
}
