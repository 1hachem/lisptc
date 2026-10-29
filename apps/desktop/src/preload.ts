import type { DesktopSettings } from "@repo/desktop-protocol";
import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionState } from "./bridge.ts";
import type { UpdateState } from "./updates.ts";

contextBridge.exposeInMainWorld("lisptcDesktop", {
	retry: (): void => ipcRenderer.send("desktop:retry"),
	settings: (): Promise<DesktopSettings> =>
		ipcRenderer.invoke("desktop:settings"),
	updateSettings: (
		change: Partial<DesktopSettings>,
	): Promise<DesktopSettings> =>
		ipcRenderer.invoke("desktop:update-settings", change),
	onSettings: (listener: (settings: DesktopSettings) => void): (() => void) => {
		const relay = (_event: unknown, settings: DesktopSettings) =>
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
	installUpdate: (): Promise<void> =>
		ipcRenderer.invoke("desktop:install-update"),
});
