import {
	BotEngine,
	EXPRESSION_BY_ID,
	RAYON,
	SHAPE_BY_ID,
	type StateId,
} from "@repo/bloub";
import { useEffect, useRef } from "react";
import { drawIcon, ICON_FACE, ICON_SHAPE, iconHalf } from "../lib/bot-icon.ts";
import { useAgentMood } from "../lib/mood.ts";

/**
 * The tab icon, alive: the same bot the transcript shows, blinking on the
 * engine's own schedule, wearing whatever the agent is doing (`lib/mood.ts`).
 *
 * No file format animates a favicon by itself — an `.ico` is a bundle of stills,
 * and Chrome and Safari rasterise an SVG icon once and ignore any animation
 * inside it. So the frames are drawn here, one canvas per tick, and handed over
 * as a data URL on a `<link rel="icon">` this component owns.
 *
 * That is a lot of moving parts for a 16px drawing, which is why every one of
 * them sits inside a `try`: on ANY failure the static links go back exactly as
 * they were and this never runs again, so the worst case is the checked-in
 * `favicon.ico` the page already shipped with. The first frame is also drawn
 * BEFORE the head is touched, so a browser that cannot do this never loses its
 * icon in the first place.
 *
 * Renders nothing.
 */

/**
 * One render, at the size a tab asks for on a 2× display. The static .ico still
 * carries 16/32/48 because it has to answer without a canvas; here there is a
 * single consumer, and it is the browser chrome.
 */
const ICON_PX = 32;

/**
 * The engine's own reference rate: `BLINK_DUR` in the bot package is documented
 * as "1 to 2 frames at 10 fps", which is what the video was measured at. Faster
 * would spend a favicon repaint per frame on detail a tab cannot show.
 */
const FPS = 10;
const FRAME_MS = 1000 / FPS;

/**
 * The bot package pre-draws its blink schedule out to 900 s, and past the end of
 * it the eyes simply never close again. A chat tab open for a quarter of an hour
 * is ordinary, so the engine is rewound well before that: `reset` re-poses it on
 * the state it is already in and restarts the resting drift, which at 32px is a
 * sub-pixel jump.
 */
const REWIND_AFTER = 600;

interface Live {
	setState: (state: StateId) => void;
	stop: () => void;
}

/**
 * Starts the loop and returns the handles to drive it. `null` means something
 * needed is missing, and in that case the head is left exactly as it was.
 */
function start(initial: StateId): Live | null {
	const shape = SHAPE_BY_ID.get(ICON_SHAPE);
	const face = EXPRESSION_BY_ID.get(ICON_FACE);
	if (!shape || !face) return null;

	const canvas = document.createElement("canvas");
	canvas.width = ICON_PX;
	canvas.height = ICON_PX;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	/*
	 * Posed at rest first, whatever state the page loaded into, because that is
	 * where the crop has to be measured (see `iconHalf`) — then rewound onto the
	 * state the agent is actually in, with no transition to show.
	 */
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

	/*
	 * The first frame is drawn before the head is touched at all. `Path2D` and
	 * `toDataURL` are the two things here that a browser could refuse, and
	 * refusing them now costs nothing — refusing them after the swap would leave
	 * the tab with an empty icon.
	 */
	paint();

	/**
	 * The page's own icon links are taken OVER rather than out-ranked. A browser
	 * picks among the icons a page declares by its own rules — Chrome prefers the
	 * SVG, others go by `sizes` — so leaving them in place would be a bet on which
	 * one wins. They are kept, in order, to be put back on the way out.
	 */
	const taken = [
		...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
	];
	for (const l of taken) l.remove();
	document.head.append(link);

	/**
	 * Wraps everything the browser calls back into. A throw inside a rAF callback
	 * would otherwise leave the loop running on a broken frame, with the head
	 * still ours.
	 */
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
		/*
		 * Clamped, for the reason the avatar's own loop clamps: rAF is suspended
		 * while a tab is hidden, so the first frame back would otherwise carry the
		 * whole gap and throw the animation minutes forward.
		 */
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

	/*
	 * A hidden tab throttles rAF to about a frame a second, so the loop is parked
	 * instead. The last frame stays on the tab, and a mood that arrives meanwhile
	 * is painted by `setState` below — which is the whole point of animating the
	 * icon: that frame is what a backgrounded tab shows.
	 */
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
				// Nothing is running to draw a morph, so the state is posed outright and
				// painted once: what's lost is the transition, not the state.
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
	const { state } = useAgentMood();
	const live = useRef<Live | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mounted once — `state` reaches the engine through the effect below, which is the point: the engine morphs between states and would lose that if it were rebuilt per state
	useEffect(() => {
		// Someone who asked for less motion keeps the static icon, which is a
		// complete one: this animation carries nothing the shape doesn't.
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
