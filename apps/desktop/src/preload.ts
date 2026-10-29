import type { DesktopPreferences } from "@repo/shared/desktop";
import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionState } from "./bridge.ts";
import type { UpdateState } from "./updates.ts";

contextBridge.exposeInMainWorld("lisptcDesktop", {
	retry: (): void => ipcRenderer.send("desktop:retry"),
	settings: (): Promise<DesktopPreferences> =>
		ipcRenderer.invoke("desktop:settings"),
	updateSettings: (
		change: Partial<DesktopPreferences>,
	): Promise<DesktopPreferences> =>
		ipcRenderer.invoke("desktop:update-settings", change),
	onSettings: (
		listener: (settings: DesktopPreferences) => void,
	): (() => void) => {
		const relay = (_event: unknown, settings: DesktopPreferences) =>
			listener(settings);
		ipcRenderer.on("desktop:settings-changed", relay);
		return () => ipcRenderer.off("desktop:settings-changed", relay);
	},
	update: (): Promise<UpdateState> => ipcRenderer.invoke("desktop:update"),
	onUpdate: (listener: (state: UpdateState) => void): (() => void) => {
		const relay = (_event: unknown, state: UpdateState) => listener(state);
		ipcRenderer.on("desktop:update-changed", relay);
		return () => ipcRenderer.off("desktop:update-changed", relay);
	},
	connection: (): Promise<ConnectionState> =>
		ipcRenderer.invoke("desktop:connection"),
	onConnection: (listener: (state: ConnectionState) => void): (() => void) => {
		const relay = (_event: unknown, state: ConnectionState) => listener(state);
		ipcRenderer.on("desktop:connection-changed", relay);
		return () => ipcRenderer.off("desktop:connection-changed", relay);
	},
	reconnect: (): Promise<void> => ipcRenderer.invoke("desktop:reconnect"),
	zoom: (): Promise<number> => ipcRenderer.invoke("desktop:zoom"),
	setZoom: (direction: "in" | "out" | "reset"): Promise<void> =>
		ipcRenderer.invoke("desktop:set-zoom", direction),
	onZoom: (listener: (factor: number) => void): (() => void) => {
		const relay = (_event: unknown, factor: number) => listener(factor);
		ipcRenderer.on("desktop:zoom-changed", relay);
		return () => ipcRenderer.off("desktop:zoom-changed", relay);
	},
	installUpdate: (): Promise<void> =>
		ipcRenderer.invoke("desktop:install-update"),
});
