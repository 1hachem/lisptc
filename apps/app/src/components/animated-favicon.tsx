import {
	BotEngine,
	EXPRESSION_BY_ID,
	RAYON,
	SHAPE_BY_ID,
	type StateId,
} from "@repo/bloub";
import { useEffect, useRef } from "react";
import { useAgent } from "../lib/agent.tsx";
import { drawIcon, ICON_FACE, ICON_SHAPE, iconHalf } from "../lib/bot-icon.ts";

const ICON_PX = 32;

const FPS = 10;
const FRAME_MS = 1000 / FPS;

const REWIND_AFTER = 600;

interface Live {
	setState: (state: StateId) => void;
	stop: () => void;
}

function start(initial: StateId): Live | null {
	const shape = SHAPE_BY_ID.get(ICON_SHAPE);
	const face = EXPRESSION_BY_ID.get(ICON_FACE);
	if (!shape || !face) return null;

	const canvas = document.createElement("canvas");
	canvas.width = ICON_PX;
	canvas.height = ICON_PX;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	const engine = new BotEngine(RAYON, "idle", shape.radii, face);
	const half = iconHalf(engine.sample(0));
	if (initial !== "idle") engine.reset(initial, 0);

	const link = document.createElement("link");
	link.rel = "icon";
	link.type = "image/png";

	let clock = 0;
	let last = 0;
	let due = 0;
	let raf = 0;
	let live = true;

	const paint = () => {
		drawIcon(ctx, engine.sample(clock), {
			size: ICON_PX,
			radius: engine.scale,
			half,
		});
		link.href = canvas.toDataURL("image/png");
	};

	paint();

	const taken = [
		...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
	];
	for (const l of taken) l.remove();
	document.head.append(link);

	function guard<A extends unknown[]>(fn: (...args: A) => void) {
		return (...args: A) => {
			if (!live) return;
			try {
				fn(...args);
			} catch (err) {
				stop();
				console.warn("animated favicon stopped:", err);
			}
		};
	}

	const onFrame = guard((ms: number) => {
		raf = requestAnimationFrame(onFrame);
		const dt = last ? Math.min((ms - last) / 1000, 0.25) : 0;
		last = ms;
		clock += dt;
		due += dt * 1000;
		if (due < FRAME_MS) return;
		due = 0;
		if (clock > REWIND_AFTER) {
			engine.reset(engine.state, 0);
			clock = 0;
		}
		paint();
	});

	const onVisibility = guard(() => {
		if (document.hidden) {
			cancelAnimationFrame(raf);
			raf = 0;
			last = 0;
			return;
		}
		if (!raf) raf = requestAnimationFrame(onFrame);
	});

	function stop() {
		if (!live) return;
		live = false;
		cancelAnimationFrame(raf);
		document.removeEventListener("visibilitychange", onVisibility);
		link.remove();
		for (const l of taken) document.head.append(l);
	}

	document.addEventListener("visibilitychange", onVisibility);
	if (!document.hidden) raf = requestAnimationFrame(onFrame);

	return {
		setState: guard((next: StateId) => {
			if (engine.state === next) return;
			if (document.hidden) {
				engine.reset(next, clock);
				paint();
				return;
			}
			engine.setState(next, clock);
		}),
		stop,
	};
}

export function AnimatedFavicon() {
	const { state } = useAgent();
	const live = useRef<Live | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mounted once; `state` reaches the engine through the effect below, so the engine keeps morphing between states
	useEffect(() => {
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

		try {
			live.current = start(state);
		} catch (err) {
			console.warn("animated favicon unavailable:", err);
			live.current = null;
		}

		return () => {
			live.current?.stop();
			live.current = null;
		};
	}, []);

	useEffect(() => {
		live.current?.setState(state);
	}, [state]);

	return null;
}
