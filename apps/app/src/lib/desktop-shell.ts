import type { DesktopPreferences } from "@repo/shared/desktop";
import { useEffect, useState } from "react";

interface DesktopShell {
	settings: () => Promise<DesktopPreferences | undefined>;
	updateSettings: (
		change: Partial<DesktopPreferences>,
	) => Promise<DesktopPreferences | undefined>;
	onSettings?: (listener: (settings: DesktopPreferences) => void) => () => void;
	update?: () => Promise<UpdateState | undefined>;
	onUpdate?: (listener: (state: UpdateState) => void) => () => void;
	installUpdate?: () => Promise<void>;
	connection?: () => Promise<ConnectionState | undefined>;
	onConnection?: (listener: (state: ConnectionState) => void) => () => void;
	reconnect?: () => Promise<void>;
	zoom?: () => Promise<number | undefined>;
	setZoom?: (direction: ZoomDirection) => Promise<void>;
	onZoom?: (listener: (factor: number) => void) => () => void;
}

type ZoomDirection = "in" | "out" | "reset";

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
	const [settings, setSettings] = useState<DesktopPreferences>();
	useEffect(() => {
		void shell()?.settings().then(setSettings);
		return shell()?.onSettings?.(setSettings);
	}, []);
	const update = (change: Partial<DesktopPreferences>) => {
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

export function useDesktopZoom() {
	const [factor, setFactor] = useState<number>();
	useEffect(() => {
		void shell()?.zoom?.().then(setFactor);
		return shell()?.onZoom?.(setFactor);
	}, []);
	const zoom = (direction: ZoomDirection) => {
		void shell()?.setZoom?.(direction);
	};
	return { factor, zoom };
}
