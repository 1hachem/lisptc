import { contextBridge, ipcRenderer } from "electron";
import type { DesktopSettings } from "./settings.ts";

contextBridge.exposeInMainWorld("lisptcDesktop", {
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
});
