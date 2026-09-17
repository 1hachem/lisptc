import { createServer } from "node:http";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SESSIONS = join(here, "sessions");
const PORT = Number(process.env.CANVAS_PORT ?? 4599);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

mkdirSync(SESSIONS, { recursive: true });

const listeners = new Map();

function subscribe(id, res) {
	let set = listeners.get(id);
	if (!set) {
		set = new Set();
		listeners.set(id, set);
	}
	set.add(res);
	return () => {
		set.delete(res);
		if (set.size === 0) listeners.delete(id);
	};
}

function notify(id) {
	for (const res of listeners.get(id) ?? []) res.write("event: update\ndata: 1\n\n");
}

const pending = new Map();
watch(SESSIONS, (_event, filename) => {
	if (!filename?.endsWith(".html")) return;
	const id = filename.slice(0, -5);
	clearTimeout(pending.get(id));
	pending.set(
		id,
		setTimeout(() => {
			pending.delete(id);
			notify(id);
		}, 40),
	);
});

async function sessions() {
	const files = (await readdir(SESSIONS)).filter((f) => f.endsWith(".html"));
	const rows = await Promise.all(
		files.map(async (f) => {
			const path = join(SESSIONS, f);
			const [info, text] = await Promise.all([stat(path), readFile(path, "utf8")]);
			return {
				id: f.slice(0, -5),
				mtime: info.mtimeMs,
				title: /<title>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim() || f.slice(0, -5),
			};
		}),
	);
	return rows.sort((a, b) => b.mtime - a.mtime);
}

async function sweep() {
	const cutoff = Date.now() - MAX_AGE_MS;
	for (const row of await sessions()) {
		if (row.mtime < cutoff) await unlink(join(SESSIONS, `${row.id}.html`)).catch(() => {});
	}
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(id, list) {
	const options = list
		.map(
			(row) =>
				`<option value="${escape(row.id)}"${row.id === id ? " selected" : ""}>${escape(row.title)}</option>`,
		)
		.join("");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>canvas</title>
<style>
:root {
	color-scheme: light dark;
	--bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --bar: #fafafaee; --live: #16a34a;
}
@media (prefers-color-scheme: dark) {
	:root { --bg: #0b0b0d; --fg: #e8e8ea; --muted: #8b8b93; --line: #26262b; --bar: #121215ee; --live: #4ade80; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
	font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
#bar { position: sticky; top: 0; z-index: 999; display: flex; gap: .75rem; align-items: center;
	padding: .5rem .9rem; background: var(--bar); backdrop-filter: blur(8px);
	border-bottom: 1px solid var(--line); font-size: 12px; color: var(--muted); }
#dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--live); flex: none;
	transition: background .2s, box-shadow .2s; }
#dot.off { background: #ef4444; }
#dot.ping { box-shadow: 0 0 0 4px color-mix(in srgb, var(--live) 30%, transparent); }
#bar select { background: transparent; color: var(--muted); border: 1px solid var(--line);
	border-radius: 6px; padding: .15rem .35rem; font: inherit; max-width: 22rem; }
#bar .spacer { margin-left: auto; }
#canvas { padding: 1.5rem clamp(1rem, 5vw, 3.5rem) 6rem; max-width: 72rem; margin: 0 auto; }
#canvas :is(h1, h2, h3) { line-height: 1.25; }
#canvas pre { overflow-x: auto; }
#canvas table { display: block; overflow-x: auto; max-width: 100%; }
#canvas img, #canvas svg { max-width: 100%; }
</style>
<style id="canvas-style"></style>
</head>
<body>
<div id="bar">
	<span id="dot" title="live"></span>
	<select id="pick">${options}</select>
	<span class="spacer"></span>
	<span id="stamp"></span>
</div>
<div id="canvas"></div>
<script>
const id = ${JSON.stringify(id)};
const canvas = document.getElementById("canvas");
const styles = document.getElementById("canvas-style");
const dot = document.getElementById("dot");
const stamp = document.getElementById("stamp");

document.getElementById("pick").onchange = (e) => { location.pathname = "/s/" + e.target.value; };

function hydrate(root) {
	for (const old of root.querySelectorAll("script")) {
		const s = document.createElement("script");
		for (const a of old.attributes) s.setAttribute(a.name, a.value);
		if (old.src) s.async = false;
		else if (s.type === "module") s.textContent = old.textContent;
		else s.textContent = "(function(){\\n" + old.textContent + "\\n})();";
		old.replaceWith(s);
	}
}

async function load() {
	const res = await fetch("/raw/" + id + "?t=" + Date.now(), { cache: "no-store" });
	if (!res.ok) return;
	const doc = new DOMParser().parseFromString(await res.text(), "text/html");
	const bottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
	const y = window.scrollY;
	if (doc.title) document.title = doc.title;
	styles.textContent = "";
	const head = document.head;
	for (const n of head.querySelectorAll("[data-canvas-head]")) n.remove();
	for (const n of doc.head.querySelectorAll("style, link[rel=stylesheet], script")) {
		const c = n.cloneNode(true);
		c.setAttribute("data-canvas-head", "");
		head.appendChild(c);
	}
	hydrate(head);
	canvas.innerHTML = doc.body.innerHTML;
	hydrate(canvas);
	stamp.textContent = new Date().toLocaleTimeString();
	dot.classList.add("ping");
	setTimeout(() => dot.classList.remove("ping"), 400);
	requestAnimationFrame(() => window.scrollTo(0, bottom ? document.body.scrollHeight : y));
}

const events = new EventSource("/events/" + id);
events.addEventListener("update", load);
events.onopen = () => dot.classList.remove("off");
events.onerror = () => dot.classList.add("off");
load();
</script>
</body>
</html>`;
}

function send(res, code, type, body) {
	res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
	res.end(body);
}

createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");
	const path = url.pathname;

	if (path === "/health") return send(res, 200, "text/plain", "ok");

	if (path === "/") {
		const list = await sessions();
		if (list.length === 0) return send(res, 200, "text/html", shell("none", []));
		res.writeHead(302, { location: `/s/${list[0].id}` });
		return res.end();
	}

	if (path.startsWith("/s/")) {
		const id = decodeURIComponent(path.slice(3));
		return send(res, 200, "text/html", shell(id, await sessions()));
	}

	if (path.startsWith("/raw/")) {
		const id = decodeURIComponent(path.slice(5));
		if (!/^[\w.-]+$/.test(id)) return send(res, 400, "text/plain", "bad id");
		const body = await readFile(join(SESSIONS, `${id}.html`), "utf8").catch(() => null);
		if (body === null) return send(res, 404, "text/html", "<p>no page yet</p>");
		return send(res, 200, "text/html", body);
	}

	if (path.startsWith("/events/")) {
		const id = decodeURIComponent(path.slice(8));
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-store",
			connection: "keep-alive",
		});
		res.write("retry: 500\n\n");
		const beat = setInterval(() => res.write(": beat\n\n"), 25000);
		const off = subscribe(id, res);
		req.on("close", () => {
			clearInterval(beat);
			off();
		});
		return;
	}

	send(res, 404, "text/plain", "not found");
}).listen(PORT, "127.0.0.1", async () => {
	await sweep().catch(() => {});
	process.stdout.write(`canvas on http://localhost:${PORT}\n`);
});
