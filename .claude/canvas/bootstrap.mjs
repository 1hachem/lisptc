import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
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

function template(id, cwd) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>canvas ${id.slice(0, 8)}</title>
</head>
<body>
<h1>canvas</h1>
<p style="color:#71717a">${cwd} &middot; session ${id.slice(0, 8)} &middot; waiting for the first answer.</p>
</body>
</html>
`;
}

const raw = await new Promise((resolve) => {
	let buf = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (d) => {
		buf += d;
	});
	process.stdin.on("end", () => resolve(buf));
	setTimeout(() => resolve(buf), 1000);
});

let input = {};
try {
	input = JSON.parse(raw || "{}");
} catch {}

const id = String(input.session_id ?? `adhoc-${Date.now()}`).replace(/[^\w.-]/g, "");
const cwd = input.cwd ?? process.cwd();
const page = join(SESSIONS, `${id}.html`);

mkdirSync(SESSIONS, { recursive: true });
if (!existsSync(page)) writeFileSync(page, template(id, cwd));

const up = await ensureServer();
const url = `${ORIGIN}/s/${id}`;

const context = up
	? [
			"Canvas is live for this session.",
			`Page file: ${page}`,
			`Open in browser: ${url} (live, never needs a refresh)`,
				`Open it for the user with: node .claude/canvas/open.mjs ${id}`,
			"",
			"Write to that file with Write/Edit whenever an answer is visual or long:",
			"diagrams, tables, comparisons, plans, file walkthroughs, anything interactive.",
			"The browser swaps in the new HTML the moment the file changes.",
			"Keep the terminal reply to one or two lines pointing at what landed on the page.",
			"Short factual answers stay in the terminal only.",
			"The canvas skill holds the full conventions; load it before the first write.",
		].join("\n")
	: `Canvas server failed to start on ${ORIGIN}; see ${join(here, "server.log")}. Answer in the terminal.`;

process.stdout.write(
	JSON.stringify({
		hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
	}),
);
