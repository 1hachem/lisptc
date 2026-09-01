/**
 * The dev server: one long-lived socket, a hot-swapped app.
 *
 * `node --watch` restarted the whole process on every edit, which released and
 * re-bound the port each time — and since shutting down waits on open SSE
 * streams, the dying process regularly outlived its replacement and left it on
 * EADDRINUSE. Here the listening socket is created once and kept for the life of
 * the process; only the app's module graph is rebuilt.
 *
 * The rebuild is a resolve hook that stamps a generation counter onto every
 * workspace source URL. Node caches modules by URL, so a new query string is a
 * new module: re-importing `./app.ts` re-evaluates it *and* every local module
 * it pulls in, across packages. node_modules keeps its plain URLs — re-parsing
 * langchain on every keystroke would cost more than the restart ever did.
 *
 * The same hook doubles as the file watcher's source of truth: it sees every
 * local file the graph resolves, so we watch exactly the directories the app
 * actually depends on, and a new dependency starts being watched the moment it
 * is first imported.
 *
 * A reload drops in-process state (per-thread REPLs, KV warm status) exactly as
 * a restart did. What it keeps is the socket: requests already in flight finish
 * against the old graph, and the next one lands on the new. Superseded graphs
 * stay in the module cache under their old URLs, so memory grows slowly over a
 * long editing session — restart the dev server if it ever starts to matter.
 */

import { type FSWatcher, watch } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { formatError, log } from "./log.ts";
import { startServer } from "./server.ts";

const REPO_ROOT = new URL("../../../", import.meta.url);
const SOURCE_FILE = /\.(ts|tsx|json)$/;
// Long enough to collapse an editor's write dance (temp file, rename, chmod)
// into a single reload, short enough to feel immediate.
const DEBOUNCE_MS = 80;

// Bumped before each reload; read by the resolve hook below.
let generation = 0;

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (
			!resolved.url.startsWith(REPO_ROOT.href) ||
			resolved.url.includes("/node_modules/")
		) {
			return resolved;
		}
		watchDir(dirname(fileURLToPath(resolved.url)));
		return { ...resolved, url: `${resolved.url}?hmr=${generation}` };
	},
});

const watchers = new Map<string, FSWatcher>();

function watchDir(dir: string): void {
	if (watchers.has(dir)) return;
	try {
		// Deliberately not `{ recursive: true }`: a recursive watcher stops
		// reporting writes to a file once its inode is replaced, and replacing the
		// inode (write a temp file, rename it over the original) is how vim, VS
		// Code and `sed -i` all save. A plain directory watch keeps reporting.
		watchers.set(
			dir,
			watch(dir, (_event, filename) => {
				if (filename && SOURCE_FILE.test(filename))
					onChange(join(dir, filename));
			}),
		);
	} catch (err) {
		log.warn(`cannot watch ${dir} — ${formatError(err)}`);
	}
}

const changed = new Set<string>();
let debounce: NodeJS.Timeout | undefined;

function onChange(file: string): void {
	changed.add(file);
	clearTimeout(debounce);
	debounce = setTimeout(flush, DEBOUNCE_MS);
}

function flush(): void {
	const files = [...changed];
	changed.clear();
	// This module and the server lifecycle are the supervisor itself: they are
	// loaded once, outside the graph a reload rebuilds.
	if (
		files.some((f) => f === import.meta.filename || f.endsWith("/server.ts"))
	) {
		log.warn("the dev server itself changed — restart `pnpm dev` to apply it");
	}
	const root = fileURLToPath(REPO_ROOT);
	const reason =
		files.length === 1
			? relative(root, files[0])
			: `${files.length} files changed`;
	// Serialized: a burst of saves must not interleave two imports of the same
	// graph, and the app must end up on the newest generation.
	reloads = reloads.then(() => reload(reason));
}

let app: Hono | undefined;
let reloads: Promise<void> = Promise.resolve();

async function reload(reason: string): Promise<void> {
	generation += 1;
	const started = performance.now();
	try {
		app = (await import("./app.ts")).createApp();
		log.info(
			`reloaded (${reason}) in ${Math.round(performance.now() - started)}ms`,
		);
	} catch (err) {
		log.error(
			`reload failed (${reason}) — still serving the previous build\n${formatError(err)}`,
		);
	}
}

await reload("startup");

startServer({
	// Read through `app` on every request rather than capturing it, so a reload
	// swaps what the next request hits. A failed startup build leaves it unset —
	// the port is still ours, and the next edit can fix it.
	fetch: (req, env) =>
		app?.fetch(req, env) ??
		new Response("api failed to build — check the dev server output", {
			status: 503,
		}),
	port: Number(process.env.PORT ?? 3001),
	exitOnUncaught: false,
});
