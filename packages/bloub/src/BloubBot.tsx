import {
	type Ref,
	useEffect,
	useId,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { type Block, blockAt, defaultCycle, offsetOf } from "./bot/cycles";
import { NOTIF_BLUE } from "./bot/decor";
import { BotEngine, type BotFrame, type Look } from "./bot/engine";
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from "./bot/expressions";
import { clamp, easings } from "./bot/math";
import { DEMI_VIEWBOX, RAYON } from "./bot/repere";
import {
	COLOR_BY_ID,
	DEFAULT_COLOR,
	DEFAULT_SHAPE,
	mixHex,
	SHAPE_BY_ID,
} from "./bot/skins";
import { STATE_BY_ID, type StateId } from "./bot/states";
import { type Aim, type GazeScript, lookTarget, TURN_TIME } from "./gaze";

const CYCLE_PAR_DEFAUT: Block[] = defaultCycle().blocks;

export interface BloubBotProps {
	size?: number;
	shape?: string;
	color?: string;
	expression?: string;
	paper?: string;
	ink?: string;
	frozenAt?: number;
	cycle?: Block[];
	follow?: boolean;
	aim?: (a: Aim) => Look;
	gaze?: GazeScript | null;
	eyeScale?: number;
	ariaLabel?: string;
	state?: StateId;
	block?: number;
	playing?: boolean;
	onStateChange?: (id: StateId) => void;
	onBlockChange?: (index: number) => void;
	onElapsedChange?: (seconds: number) => void;
	ref?: Ref<BloubBotHandle | null>;
}

export interface BloubBotHandle {
	seek(index: number, offset?: number): void;
	rendAt(t: number): void;
}

function useWatch(effet: () => void, deps: unknown[]) {
	const precedentes = useRef<unknown[] | null>(null);
	useEffect(() => {
		const avant = precedentes.current;
		precedentes.current = deps;
		if (avant === null) return;
		if (avant.length === deps.length && avant.every((v, i) => v === deps[i]))
			return;
		effet();
		// biome-ignore lint/correctness/useExhaustiveDependencies: the watcher's own array, compared by hand above
	}, deps);
}

const SCRIPT_MORPH = 1 / 60;

export function BloubBot({
	size = 320,
	shape = DEFAULT_SHAPE,
	color = DEFAULT_COLOR,
	expression = DEFAULT_EXPRESSION,
	paper = "#f9f9f9",
	ink: inkCss,
	frozenAt,
	cycle = CYCLE_PAR_DEFAUT,
	follow = false,
	aim = lookTarget,
	gaze = null,
	eyeScale = 1,
	ariaLabel = "Avatar bloub anime",
	state,
	block,
	playing = false,
	onStateChange,
	onBlockChange,
	onElapsedChange,
	ref,
}: BloubBotProps) {
	const R = RAYON;
	const VB = DEMI_VIEWBOX;

	const shapeRadii = SHAPE_BY_ID.get(shape)?.radii ?? null;
	const ink = inkCss ?? COLOR_BY_ID.get(color)?.hex ?? "#0a0a0c";
	const expressionDef = EXPRESSION_BY_ID.get(expression) ?? null;

	const svg = useRef<SVGSVGElement | null>(null);

	const moteur = useRef<BotEngine | null>(null);
	moteur.current ??= new BotEngine(
		R,
		state ?? "idle",
		shapeRadii,
		expressionDef,
	);
	const engine = moteur.current;

	const [frame, setFrame] = useState<BotFrame>(() =>
		engine.sample(frozenAt ?? 0),
	);

	const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const maskId = `bot-mask-${uid}`;

	const l = useRef({
		raf: 0,
		nextAt: Number.POSITIVE_INFINITY,
		last: 0,
		clock: 0,
		blockStart: 0,
		dernierBloc: -1,
		block: block ?? 0,
		state: state ?? "idle",
		elapsed: 0,
		pointer: null as { x: number; y: number } | null,
		aiming: false,
		turnSince: 0,
		gazeSince: 0,
		scripted: false,
	}).current;

	const p = useRef({
		cycle,
		playing,
		follow,
		aim,
		gaze,
		onStateChange,
		onBlockChange,
		onElapsedChange,
	});
	p.current = {
		cycle,
		playing,
		follow,
		aim,
		gaze,
		onStateChange,
		onBlockChange,
		onElapsedChange,
	};

	function poseElapsed(v: number) {
		if (l.elapsed === v) return;
		l.elapsed = v;
		p.current.onElapsedChange?.(v);
	}

	function poseState(id: StateId) {
		if (l.state === id) return;
		l.state = id;
		p.current.onStateChange?.(id);
	}

	function poseBlock(i: number) {
		if (l.block === i) return;
		l.block = i;
		p.current.onBlockChange?.(i);
	}

	function apply(i: number, from = 0) {
		const b = p.current.cycle[i];
		if (!b) {
			l.nextAt = Number.POSITIVE_INFINITY;
			return;
		}
		l.blockStart = l.clock - from;
		poseElapsed(from);
		poseState(b.state);
		engine.setState(b.state, l.clock);
		l.nextAt = p.current.playing
			? l.blockStart + b.duration
			: Number.POSITIVE_INFINITY;
	}

	function goToBlock(i: number) {
		poseBlock(i);
		apply(i);
	}

	function seek(index: number, offset = 0) {
		poseBlock(index);
		apply(index, offset);
	}

	function rendAt(t: number) {
		const blocs = p.current.cycle;
		if (!blocs.length) return;
		const { index } = blockAt(blocs, t);
		if (index !== l.dernierBloc) {
			const b = blocs[index]!;
			poseState(b.state);
			if (index < l.dernierBloc) engine.reset(b.state, offsetOf(blocs, index));
			else engine.setState(b.state, offsetOf(blocs, index));
			l.dernierBloc = index;
		}
		setFrame(engine.sample(t));
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: the handle reads refs only, so it need not be rebuilt
	useImperativeHandle(ref, () => ({ seek, rendAt }), []);

	function onPointerMove(event: PointerEvent) {
		if (event.pointerType === "touch") return;
		l.pointer = { x: event.clientX, y: event.clientY };
	}

	function onPointerLeave() {
		l.pointer = null;
	}

	function release() {
		if (!l.aiming) return;
		engine.setLook(null, l.clock, TURN_TIME);
		l.aiming = false;
	}

	function detach() {
		window.removeEventListener("pointermove", onPointerMove);
		document.removeEventListener("pointerleave", onPointerLeave);
	}

	function viser() {
		if (!STATE_BY_ID.get(l.state)?.baseFace) {
			release();
			return;
		}
		const box = svg.current?.getBoundingClientRect();
		if (!box || box.width === 0 || box.height === 0) return;
		if (!l.aiming) l.turnSince = l.clock;
		const demiLargeur = Math.max(1, window.innerWidth / 2);
		const demiHauteur = Math.max(1, window.innerHeight / 2);
		const pointer = l.pointer;
		engine.setLook(
			p.current.aim({
				nx: pointer
					? clamp((pointer.x - (box.left + box.width / 2)) / demiLargeur, -1, 1)
					: 0,
				ny: pointer
					? clamp((pointer.y - (box.top + box.height / 2)) / demiHauteur, -1, 1)
					: 0,
				tour: easings.easeOutQuint(clamp((l.clock - l.turnSince) / TURN_TIME)),
				pointer: pointer !== null,
			}),
			l.clock,
		);
		l.aiming = true;
	}

	function scriptedGaze(run: GazeScript) {
		engine.setLook(run(l.clock - l.gazeSince), l.clock, SCRIPT_MORPH);
	}

	function redrawFrozen() {
		if (frozenAt === undefined) return;
		setFrame(engine.sample(frozenAt));
	}

	function tick(ms: number) {
		l.raf = requestAnimationFrame(tick);
		const dt = l.last ? Math.min((ms - l.last) / 1000, 0.064) : 0;
		l.last = ms;
		l.clock += dt;

		if (p.current.playing) {
			if (l.clock >= l.nextAt && p.current.cycle.length) {
				goToBlock((l.block + 1) % p.current.cycle.length);
			} else {
				poseElapsed(l.clock - l.blockStart);
			}
		}

		if (p.current.follow) viser();
		else if (p.current.gaze) scriptedGaze(p.current.gaze);

		setFrame(engine.sample(l.clock));
	}

	const anime = frozenAt === undefined;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the loop mounts once and reads props through `p`
	useEffect(() => {
		if (!anime) return;
		if (state === undefined || playing) apply(l.block, l.elapsed);
		l.raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(l.raf);
			l.last = 0;
		};
	}, [anime]);

	const ecoute = follow && anime;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the listeners read `l` only
	useEffect(() => {
		if (!ecoute) return;
		window.addEventListener("pointermove", onPointerMove);
		document.addEventListener("pointerleave", onPointerLeave);
		return () => {
			detach();
			release();
		};
	}, [ecoute]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: watches `gaze`; everything else comes from `l`
	useEffect(() => {
		if (gaze) {
			l.gazeSince = l.clock;
			l.scripted = true;
			engine.setLook(gaze(0), l.clock - SCRIPT_MORPH, SCRIPT_MORPH);
			return;
		}
		if (!l.scripted) return;
		engine.setLook(null, l.clock);
		l.scripted = false;
	}, [gaze]);

	useWatch(() => {
		if (block === undefined || block === l.block) return;
		l.block = block;
		apply(block);
	}, [block]);

	useWatch(() => {
		if (state === undefined) return;
		l.state = state;
		if (engine.state === state) return;
		engine.setState(state, l.clock);
		redrawFrozen();
	}, [state]);

	useWatch(() => {
		if (playing) apply(l.block, l.elapsed);
		else l.nextAt = Number.POSITIVE_INFINITY;
	}, [playing]);

	useWatch(() => {
		if (!cycle.length) {
			l.nextAt = Number.POSITIVE_INFINITY;
			return;
		}
		const i = Math.min(l.block, cycle.length - 1);
		if (i !== l.block) {
			goToBlock(i);
			return;
		}
		l.nextAt = playing
			? l.blockStart + cycle[i]!.duration
			: Number.POSITIVE_INFINITY;
	}, [cycle]);

	useWatch(() => {
		engine.setShape(shapeRadii, l.clock);
		redrawFrozen();
	}, [shapeRadii]);

	useWatch(() => {
		engine.setExpression(expressionDef, l.clock);
		redrawFrozen();
	}, [expressionDef]);

	useWatch(redrawFrozen, [frozenAt]);

	function renderDot(dot: BotFrame["dots"][number], key: string) {
		const fill =
			dot.color ??
			(dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
		return dot.d ? (
			<path
				key={key}
				d={dot.d}
				fill={fill}
				opacity={dot.opacity}
				transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`}
			/>
		) : (
			<circle
				key={key}
				cx={dot.x}
				cy={dot.y}
				r={dot.r}
				fill={fill}
				opacity={dot.opacity}
			/>
		);
	}

	return (
		<svg
			ref={svg}
			width={size}
			height={size}
			viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
			role="img"
			aria-label={ariaLabel}
		>
			<defs>
				<mask
					id={maskId}
					maskUnits="userSpaceOnUse"
					x={-VB}
					y={-VB}
					width={VB * 2}
					height={VB * 2}
				>
					<path d={frame.bodyPath} fill="#fff" />
					{frame.eyes.map((eye, i) => (
						<path
							// biome-ignore lint/suspicious/noArrayIndexKey: the index IS the identity - the engine always emits left eye then right
							key={i}
							d={eye.d}
							transform={
								eyeScale === 1 ? eye.matrix : `${eye.matrix} scale(${eyeScale})`
							}
							opacity={eye.alpha}
							fill="#000"
						/>
					))}
					{frame.notch && (
						<circle
							cx={frame.notch.x}
							cy={frame.notch.y}
							r={frame.notch.r}
							fill="#000"
						/>
					)}
				</mask>

				{frame.arcs.map((arc) => (
					<linearGradient
						key={arc.id}
						id={`${uid}-${arc.id}`}
						gradientUnits="userSpaceOnUse"
						x1={arc.grad.x1}
						y1={arc.grad.y1}
						x2={arc.grad.x2}
						y2={arc.grad.y2}
					>
						{arc.grad.stops.map((c, i) => (
							<stop
								// biome-ignore lint/suspicious/noArrayIndexKey: a gradient stop has no identity beyond its rank, which is also its offset
								key={i}
								offset={i / (arc.grad.stops.length - 1)}
								stopColor={c}
							/>
						))}
					</linearGradient>
				))}
			</defs>

			<g fill="none" strokeLinecap="round">
				{frame.arcs.map((arc) => (
					<path
						key={arc.id}
						d={arc.back}
						stroke={`url(#${uid}-${arc.id})`}
						strokeWidth={arc.width}
						opacity={arc.opacity}
					/>
				))}
			</g>

			{frame.dotsBehind && (
				<g>{frame.dots.map((dot, i) => renderDot(dot, `pb${i}`))}</g>
			)}

			<g opacity={frame.bodyAlpha}>
				<path d={frame.bodyPath} fill={paper} />
				<g mask={`url(#${maskId})`}>
					<rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
				</g>
			</g>

			{!frame.dotsBehind && (
				<g>{frame.dots.map((dot, i) => renderDot(dot, `pf${i}`))}</g>
			)}

			{frame.notif && (
				<circle
					cx={frame.notif.x}
					cy={frame.notif.y}
					r={frame.notif.r}
					fill={NOTIF_BLUE}
				/>
			)}

			<g fill="none" strokeLinecap="round">
				{frame.arcs.map((arc) => (
					<path
						key={arc.id}
						d={arc.front}
						stroke={`url(#${uid}-${arc.id})`}
						strokeWidth={arc.width}
						opacity={arc.opacity}
					/>
				))}
			</g>
		</svg>
	);
}
