import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SESSIONS = join(here, "sessions");
const PORT = Number(process.env.CANVAS_PORT ?? 4599);
const ORIGIN = `http://localhost:${PORT}`;

async function alive(ms = 400) {
	try {
		const res = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(ms) });
		return res.ok;
	} catch {
		return false;
	}
}

async function ensureServer() {
	if (await alive()) return true;
	const log = openSync(join(here, "server.log"), "a");
	spawn(process.execPath, [join(here, "server.mjs")], {
		detached: true,
		stdio: ["ignore", log, log],
		env: { ...process.env, CANVAS_PORT: String(PORT) },
	}).unref();
	for (let i = 0; i < 20; i++) {
		if (await alive(200)) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return false;
}

async function newestSession() {
	const files = (await readdir(SESSIONS).catch(() => [])).filter((f) => f.endsWith(".html"));
	const stamped = await Promise.all(
		files.map(async (f) => ({ id: f.slice(0, -5), at: (await stat(join(SESSIONS, f))).mtimeMs })),
	);
	return stamped.sort((a, b) => b.at - a.at)[0]?.id;
}

function opener() {
	if (process.platform === "darwin") return ["open", []];
	if (process.platform === "win32") return ["cmd", ["/c", "start", ""]];
	return ["xdg-open", []];
}

const id = process.argv[2] ?? process.env.CLAUDE_SESSION_ID ?? (await newestSession());

if (!id) {
	console.error(`No canvas session found under ${SESSIONS}.`);
	process.exit(1);
}

if (!(await ensureServer())) {
	console.error(`Canvas server did not start on ${ORIGIN}; see ${join(here, "server.log")}.`);
	process.exit(1);
}

const url = `${ORIGIN}/s/${id}`;
const [cmd, args] = opener();
spawn(cmd, [...args, url], { detached: true, stdio: "ignore" }).unref();
console.log(url);
