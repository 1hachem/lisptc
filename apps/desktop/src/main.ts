import path from "node:path";
import { desktopEnv } from "@repo/env/desktop";
import {
	app,
	BrowserWindow,
	type IpcMainInvokeEvent,
	ipcMain,
	Menu,
	nativeImage,
	nativeTheme,
	powerMonitor,
	shell,
	Tray,
} from "electron";
import electronUpdater from "electron-updater";
import { DesktopBridge } from "./bridge.ts";
import {
	applyOpenAtLogin,
	type DesktopSettings,
	readSettings,
	startedHidden,
	writeSettings,
} from "./settings.ts";

const ERR_ABORTED = -3;
const RETRY_MS = 4000;
const LOADING_PAGE = path.join(__dirname, "loading.html");
const TRAY_ICON = path.join(__dirname, "tray.png");
const PRELOAD = path.join(__dirname, "preload.cjs");

function originOf(url: string): string | undefined {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

function targets(): string[] {
	const primary = desktopEnv.LISPTC_DESKTOP_URL;
	const fallback = desktopEnv.LISPTC_DESKTOP_FALLBACK_URL;
	return originOf(primary) === originOf(fallback)
		? [primary]
		: [primary, fallback];
}

const candidates = targets();
let current = 0;
let bridge: DesktopBridge | undefined;
let settings: DesktopSettings;
let tray: Tray | undefined;
let quitting = false;

function target(): string {
	return candidates[current] ?? desktopEnv.LISPTC_DESKTOP_URL;
}

function sameOrigin(url: string): boolean {
	return originOf(url) === originOf(target());
}

function bridgeTo(origin: string | undefined): void {
	if (origin === undefined || origin === bridge?.origin) return;
	void bridge?.stop();
	bridge = new DesktopBridge(origin, update);
	bridge.start();
}

function showLoading(window: BrowserWindow, state: "loading" | "retry"): void {
	void window.loadFile(LOADING_PAGE, {
		query: { state, target: originOf(target()) ?? "" },
	});
}

function loadTarget(window: BrowserWindow): void {
	console.log(`lisptc desktop on ${target()}`);
	bridgeTo(originOf(target()));
	void window.loadURL(target()).catch(() => undefined);
}

function onFailure(window: BrowserWindow): void {
	if (current < candidates.length - 1) {
		current += 1;
		loadTarget(window);
		return;
	}
	showLoading(window, "retry");
	setTimeout(() => {
		if (!window.isDestroyed()) loadTarget(window);
	}, RETRY_MS);
}

function reveal(): void {
	const [window] = BrowserWindow.getAllWindows();
	if (window === undefined) {
		open(true);
		return;
	}
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
}

function settingsChange(input: unknown): Partial<DesktopSettings> {
	if (typeof input !== "object" || input === null) return {};
	const change: Partial<DesktopSettings> = {};
	if ("closeToTray" in input && typeof input.closeToTray === "boolean")
		change.closeToTray = input.closeToTray;
	if ("openAtLogin" in input && typeof input.openAtLogin === "boolean")
		change.openAtLogin = input.openAtLogin;
	return change;
}

function update(input: unknown): DesktopSettings {
	const change = settingsChange(input);
	if (Object.keys(change).length === 0) return settings;
	settings = { ...settings, ...change };
	writeSettings(settings);
	if (change.openAtLogin !== undefined) applyOpenAtLogin(settings.openAtLogin);
	buildTray();
	for (const window of BrowserWindow.getAllWindows())
		window.webContents.send("desktop:settings-changed", settings);
	return settings;
}

function fromApp(event: IpcMainInvokeEvent): boolean {
	return sameOrigin(event.senderFrame?.url ?? "");
}

function serveSettings(): void {
	ipcMain.handle("desktop:settings", (event) =>
		fromApp(event) ? settings : undefined,
	);
	ipcMain.handle("desktop:update-settings", (event, input: unknown) =>
		fromApp(event) ? update(input) : undefined,
	);
}

function buildTray(): void {
	if (tray === undefined) {
		tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
		tray.setToolTip("lisptc");
		tray.on("click", reveal);
	}
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Open lisptc", click: reveal },
			{ type: "separator" },
			{
				label: "Keep running when closed",
				type: "checkbox",
				checked: settings.closeToTray,
				click: (item) => update({ closeToTray: item.checked }),
			},
			{
				label: "Start at login",
				type: "checkbox",
				checked: settings.openAtLogin,
				enabled: app.isPackaged,
				click: (item) => update({ openAtLogin: item.checked }),
			},
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		]),
	);
}

function open(visible: boolean): BrowserWindow {
	const window = new BrowserWindow({
		width: 1280,
		height: 840,
		title: "lisptc",
		show: false,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#1d2021" : "#f9f5d7",
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			preload: PRELOAD,
		},
	});
	window.once("ready-to-show", () => {
		if (visible) window.show();
	});
	window.on("close", (event) => {
		if (quitting || !settings.closeToTray) return;
		event.preventDefault();
		window.hide();
	});
	window.webContents.on("console-message", ({ level, message, sourceId }) => {
		if (level === "error" || level === "warning")
			console.error(`[page ${level}] ${message} (${sourceId})`);
	});
	window.webContents.on("did-fail-load", (_event, code, description, url) =>
		console.error(`[load failed] ${code} ${description} ${url}`),
	);
	window.webContents.on("did-navigate", (_event, url, status) => {
		if (status < 500 || url.startsWith("file:")) return;
		console.error(`[load failed] HTTP ${status} ${url}`);
		onFailure(window);
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (sameOrigin(url)) return { action: "allow" };
		void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (sameOrigin(url) || url.startsWith("file:")) return;
		event.preventDefault();
		void shell.openExternal(url);
	});
	window.webContents.on(
		"did-fail-load",
		(_event, code, _description, url, isMainFrame) => {
			if (!isMainFrame || code === ERR_ABORTED || url.startsWith("file:"))
				return;
			onFailure(window);
		},
	);
	showLoading(window, "loading");
	window.webContents.once("did-finish-load", () => loadTarget(window));
	return window;
}

if (!app.requestSingleInstanceLock()) app.quit();

app.setAsDefaultProtocolClient("lisptc");

app.on("second-instance", reveal);

const macMenu = () =>
	Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]);

app.whenReady().then(() => {
	Menu.setApplicationMenu(process.platform === "darwin" ? macMenu() : null);
	settings = readSettings();
	applyOpenAtLogin(settings.openAtLogin);
	buildTray();
	serveSettings();
	open(!startedHidden());
	if (app.isPackaged)
		void electronUpdater.autoUpdater.checkForUpdatesAndNotify();
	app.on("activate", () => {
		reveal();
	});
	powerMonitor.on("suspend", () => bridge?.pause());
	powerMonitor.on("lock-screen", () => bridge?.pause());
	powerMonitor.on("resume", () => bridge?.resume());
	powerMonitor.on("unlock-screen", () => bridge?.resume());
});

app.on("before-quit", () => {
	quitting = true;
	void bridge?.stop();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin" && !settings.closeToTray) app.quit();
});
