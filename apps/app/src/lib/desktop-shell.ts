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
	update?: () => Promise<UpdateState | undefined>;
	onUpdate?: (listener: (state: UpdateState) => void) => () => void;
	installUpdate?: () => Promise<void>;
	connection?: () => Promise<ConnectionState | undefined>;
	onConnection?: (listener: (state: ConnectionState) => void) => () => void;
	reconnect?: () => Promise<void>;
}

type ConnectionState =
	| { status: "connecting" }
	| { status: "connected" }
	| { status: "failed"; retryAt: number };

type UpdateState =
	| { status: "idle" }
	| { status: "available"; version: string }
	| { status: "downloaded"; version: string };

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

export function useDesktopUpdate() {
	const [state, setState] = useState<UpdateState>();
	useEffect(() => {
		void shell()?.update?.().then(setState);
		return shell()?.onUpdate?.(setState);
	}, []);
	const ready = state?.status === "downloaded" ? state.version : undefined;
	const install = () => {
		void shell()?.installUpdate?.();
	};
	return { ready, install };
}

export function useDesktopConnection() {
	const [state, setState] = useState<ConnectionState>();
	useEffect(() => {
		void shell()?.connection?.().then(setState);
		return shell()?.onConnection?.(setState);
	}, []);
	const reconnect = () => {
		void shell()?.reconnect?.();
	};
	return { state, reconnect };
}
