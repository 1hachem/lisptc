import path from "node:path";
import { desktopEnv } from "@repo/env/desktop";
import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron";
import electronUpdater from "electron-updater";
import { DesktopBridge } from "./bridge.ts";

const ERR_ABORTED = -3;
const RETRY_MS = 4000;
const LOADING_PAGE = path.join(__dirname, "..", "static", "loading.html");

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

function target(): string {
	return candidates[current] ?? desktopEnv.LISPTC_DESKTOP_URL;
}

function sameOrigin(url: string): boolean {
	return originOf(url) === originOf(target());
}

function bridgeTo(origin: string | undefined): void {
	if (origin === undefined || origin === bridge?.origin) return;
	void bridge?.stop();
	bridge = new DesktopBridge(origin);
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

function open(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1280,
		height: 840,
		title: "lisptc",
		show: false,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#1d2021" : "#f9f5d7",
		webPreferences: { contextIsolation: true, sandbox: true },
	});
	window.once("ready-to-show", () => window.show());
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

app.on("second-instance", () => {
	const [window] = BrowserWindow.getAllWindows();
	if (window === undefined) return;
	if (window.isMinimized()) window.restore();
	window.focus();
});

const macMenu = () =>
	Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]);

app.whenReady().then(() => {
	Menu.setApplicationMenu(process.platform === "darwin" ? macMenu() : null);
	open();
	if (app.isPackaged)
		void electronUpdater.autoUpdater.checkForUpdatesAndNotify();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) open();
	});
});

app.on("before-quit", () => {
	void bridge?.stop();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
