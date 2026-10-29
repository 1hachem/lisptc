import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { Button } from "@repo/ui";
import { type AnchorId, isAnchor, isPage, pages } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reportIssue } from "../lib/analytics.tsx";
import { useAnchorElement } from "../lib/anchors.ts";
import { postMessage } from "../lib/chat.tsx";
import { requestPanel } from "../lib/panel-requests.ts";
import { postUiAction } from "../lib/ui-action.ts";

type Tour = NonNullable<FunctionReturnType<typeof api.tours.active>>;

const GAP = 8;

const POPOVER_WIDTH = 288;

interface Box {
	top: number;
	left: number;
	width: number;
	height: number;
}

function sameBox(a: Box | undefined, b: Box | undefined): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function useBox(element: HTMLElement | undefined): Box | undefined {
	const [box, setBox] = useState<Box | undefined>(undefined);
	useEffect(() => {
		if (element === undefined) {
			setBox(undefined);
			return;
		}
		let frame = 0;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			const next =
				rect.width === 0 && rect.height === 0
					? undefined
					: {
							top: rect.top,
							left: rect.left,
							width: rect.width,
							height: rect.height,
						};
			setBox((held) => (sameBox(held, next) ? held : next));
			frame = requestAnimationFrame(measure);
		};
		measure();
		return () => cancelAnimationFrame(frame);
	}, [element]);
	return box;
}

async function tellAgent(chatId: Id<"chats">, action: string | undefined) {
	if (action === undefined) return;
	try {
		const { message } = await postUiAction(chatId, action, {});
		if (message) await postMessage(chatId, message);
	} catch (ex) {
		reportIssue(ex, { $exception_source: "tour end" });
	}
}

function popoverAt(box: Box | undefined): React.CSSProperties {
	if (box === undefined)
		return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
	const left = Math.max(
		GAP,
		Math.min(box.left, window.innerWidth - POPOVER_WIDTH - GAP),
	);
	const below = box.top + box.height + GAP;
	return below + 120 < window.innerHeight
		? { top: below, left }
		: { bottom: window.innerHeight - box.top + GAP, left };
}

function TourStep({ tour }: { tour: Tour }) {
	const step = tour.steps[tour.current];
	const anchor: AnchorId | undefined =
		step?.anchor !== undefined && isAnchor(step.anchor)
			? step.anchor
			: undefined;
	const element = useAnchorElement(anchor);
	const box = useBox(element);
	const advance = useConvexMutation(api.tours.advance);
	const skip = useConvexMutation(api.tours.skip);
	const last = tour.current + 1 >= tour.steps.length;

	const page = step?.page;
	useEffect(() => {
		if (page === undefined || !isPage(page)) return;
		requestPanel({ kind: "page", page, title: pages[page].title });
	}, [page]);

	const next = () => {
		void advance({ tour: tour._id, from: tour.current });
		if (last) void tellAgent(tour.chatId, tour.done);
	};
	const dismiss = () => {
		void skip({ tour: tour._id });
		void tellAgent(tour.chatId, tour.skip);
	};

	useEffect(() => {
		if (step?.until !== "click" || element === undefined) return;
		const clicked = () => next();
		element.addEventListener("click", clicked, { once: true });
		return () => element.removeEventListener("click", clicked);
	});

	if (step === undefined) return null;
	return createPortal(
		<div className="pointer-events-none fixed inset-0 z-50 font-mono text-[13px]">
			{box === undefined ? (
				<div className="absolute inset-0 bg-black/50" />
			) : (
				<div
					data-testid="tour-spotlight"
					className="absolute rounded-sm ring-2 ring-accent"
					style={{
						top: box.top - 4,
						left: box.left - 4,
						width: box.width + 8,
						height: box.height + 8,
						boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.5)",
					}}
				/>
			)}
			<div
				role="dialog"
				aria-label="tour"
				className="pointer-events-auto absolute flex flex-col gap-2 border border-bg2 bg-bg1 p-3 text-fg shadow-lg"
				style={{ width: POPOVER_WIDTH, ...popoverAt(box) }}
			>
				<p className="whitespace-pre-wrap break-words">{step.say}</p>
				<div className="flex items-center gap-2">
					<span className="text-dim">
						{tour.current + 1}/{tour.steps.length}
					</span>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="ml-auto rounded-none"
						onClick={dismiss}
					>
						skip
					</Button>
					{step.until === "next" && (
						<Button
							type="button"
							size="sm"
							variant="secondary"
							className="rounded-none"
							onClick={next}
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

export function Onboarding() {
	const { data: tour } = useQuery(convexQuery(api.tours.active, {}));
	if (tour === undefined || tour === null) return null;
	return <TourStep key={`${tour._id}:${tour.current}`} tour={tour} />;
}
