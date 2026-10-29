import { Button } from "@repo/ui";
import { type CSSProperties, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	type Box,
	calloutPlacement,
	type Placement,
	type Side,
} from "../lib/tour-layout.ts";

export interface CalloutStep {
	anchor?: string;
	say: string;
	until: "next" | "click";
}

const CALLOUT_WIDTH = 288;

const RING = 4;

function pageZoom(): number {
	const zoom = (document.body as HTMLElement & { currentCSSZoom?: number })
		.currentCSSZoom;
	return typeof zoom === "number" && zoom > 0 ? zoom : 1;
}

function sameBox(a: Box | undefined, b: Box | undefined): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function boxOf(element: Element): Box | undefined {
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return undefined;
	const zoom = pageZoom();
	return {
		top: rect.top / zoom,
		left: rect.left / zoom,
		width: rect.width / zoom,
		height: rect.height / zoom,
	};
}

function useBox(element: Element | null | undefined): Box | undefined {
	const [box, setBox] = useState<Box | undefined>(undefined);
	useEffect(() => {
		if (element === undefined || element === null) {
			setBox(undefined);
			return;
		}
		let frame = 0;
		const measure = () => {
			const next = boxOf(element);
			setBox((held) => (sameBox(held, next) ? held : next));
			frame = requestAnimationFrame(measure);
		};
		measure();
		return () => cancelAnimationFrame(frame);
	}, [element]);
	return box;
}

const ARROW: Record<Side, CSSProperties> = {
	right: { left: -5, top: "50%", marginTop: -5 },
	left: { right: -5, top: "50%", marginTop: -5 },
	below: { top: -5, left: "50%", marginLeft: -5 },
	above: { bottom: -5, left: "50%", marginLeft: -5 },
};

const ARROW_TURN: Record<Side, string> = {
	right: "45deg",
	left: "225deg",
	below: "135deg",
	above: "-45deg",
};

export function TourCallout({
	step,
	at,
	count,
	element,
	gaveUp,
	onNext,
	onSkip,
}: {
	step: CalloutStep;
	at: number;
	count: number;
	element: HTMLElement | undefined;
	gaveUp: boolean;
	onNext: () => void;
	onSkip: () => void;
}) {
	const box = useBox(element);
	const [callout, setCallout] = useState<HTMLDivElement | null>(null);
	const size = useBox(callout);
	if (step.anchor !== undefined && box === undefined && !gaveUp) return null;
	const placement: Placement | undefined =
		box === undefined
			? undefined
			: calloutPlacement(
					{
						top: box.top - RING,
						left: box.left - RING,
						width: box.width + 2 * RING,
						height: box.height + 2 * RING,
					},
					size ?? { width: CALLOUT_WIDTH, height: 0 },
					{
						width: window.innerWidth / pageZoom(),
						height: window.innerHeight / pageZoom(),
					},
				);
	const last = at + 1 >= count;
	const showNext = step.until === "next" || box === undefined;
	return createPortal(
		<div className="pointer-events-none fixed inset-0 z-[100] font-mono text-[13px]">
			{box === undefined ? (
				<div className="absolute inset-0 bg-bg/60" />
			) : (
				<div
					data-testid="tour-spotlight"
					className="absolute rounded-sm"
					style={{
						top: box.top - RING,
						left: box.left - RING,
						width: box.width + 2 * RING,
						height: box.height + 2 * RING,
						outline: "2px solid var(--yellow)",
						boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
					}}
				/>
			)}
			<div
				ref={setCallout}
				role="dialog"
				aria-label="tour"
				data-side={placement?.side ?? "center"}
				className="pointer-events-auto absolute flex flex-col gap-2 border border-yellow bg-bg1 p-3 text-fg shadow-lg"
				style={{
					width: CALLOUT_WIDTH,
					...(placement === undefined
						? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
						: { top: placement.top, left: placement.left }),
				}}
			>
				{placement !== undefined && (
					<span
						aria-hidden
						className="absolute size-2.5 border-yellow border-b border-l bg-bg1"
						style={{
							...ARROW[placement.side],
							rotate: ARROW_TURN[placement.side],
						}}
					/>
				)}
				<p className="whitespace-pre-wrap break-words">{step.say}</p>
				<div className="flex items-center gap-2">
					<span className="text-dim">
						{at + 1}/{count}
					</span>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="ml-auto rounded-none"
						onClick={onSkip}
					>
						skip
					</Button>
					{showNext && (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							className="rounded-none"
							onClick={onNext}
						>
							{last ? "done" : "next"}
						</Button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
