import type { DesktopSettings } from "@repo/desktop-protocol";
import { contextBridge, ipcRenderer } from "electron";

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
});
