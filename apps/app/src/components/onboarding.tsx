import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { type AnchorId, anchors, isAnchor, isPage } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useState } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import {
	anchorElement,
	useAnchorElement,
	useUnpointableWarning,
} from "../lib/anchors.ts";
import { postMessage } from "../lib/chat.tsx";
import { NEW_CHAT, type PanelContent, panelTab } from "../lib/panel-ops.ts";
import { requestPanelOps } from "../lib/panel-requests.ts";
import { pageContent, reveal } from "../lib/tour-layout.ts";
import { useUI } from "../lib/ui.tsx";
import { postUiAction } from "../lib/ui-action.ts";
import { TourCallout } from "./tour-callout.tsx";
import { TourPointer } from "./tour-pointer.tsx";
import { openFolder } from "./workspace-tree.tsx";

type Tour = NonNullable<FunctionReturnType<typeof api.tours.active>>;

type Pointer = NonNullable<FunctionReturnType<typeof api.tours.pointer>>;

const ANCHOR_WAIT_MS = 3000;

async function tellAgent(chatId: Id<"chats">, action: string | undefined) {
	if (action === undefined) return;
	try {
		const { message } = await postUiAction(chatId, action, {});
		if (message) await postMessage(chatId, message);
	} catch (ex) {
		reportIssue(ex, { $exception_source: "tour end" });
	}
}

function openBeside(content: PanelContent): void {
	requestPanelOps([
		{ op: "open", tab: panelTab(content).id, split: "right", content },
	]);
}

function openChat(): void {
	if (anchorElement("composer") === undefined) openBeside(NEW_CHAT);
}

function useReveal({ page, anchor }: { page?: string; anchor?: string }): void {
	const { setLeftOpen, setRightOpen } = useUI();
	useEffect(() => {
		if (page !== undefined && isPage(page)) openBeside(pageContent(page));
		if (anchor === undefined || !isAnchor(anchor)) return;
		reveal(anchors[anchor].location, {
			openSidebar: () => setLeftOpen(true),
			openRight: () => setRightOpen(true),
			openChat,
			openFolder,
			openPage: openBeside,
		});
	}, [page, anchor, setLeftOpen, setRightOpen]);
}

function useReportMissing(anchor: AnchorId | undefined, gaveUp: boolean) {
	useEffect(() => {
		if (anchor !== undefined && gaveUp)
			reportIssue(new Error(`anchor not on screen: ${anchor}`), {
				$exception_source: "tour anchor",
			});
	}, [anchor, gaveUp]);
}

function useGaveUp(waiting: boolean): boolean {
	const [gaveUp, setGaveUp] = useState(false);
	useEffect(() => {
		if (!waiting) return;
		const timer = setTimeout(() => setGaveUp(true), ANCHOR_WAIT_MS);
		return () => clearTimeout(timer);
	}, [waiting]);
	return gaveUp;
}

function TourStep({ tour }: { tour: Tour }) {
	const step = tour.steps[tour.current];
	const anchor: AnchorId | undefined =
		step?.anchor !== undefined && isAnchor(step.anchor)
			? step.anchor
			: undefined;
	const element = useAnchorElement(anchor);
	const gaveUp = useGaveUp(anchor !== undefined && element === undefined);
	useReportMissing(anchor, gaveUp);
	const advance = useConvexMutation(api.tours.advance);
	const skip = useConvexMutation(api.tours.skip);
	const last = tour.current + 1 >= tour.steps.length;
	useReveal(step ?? {});

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
	return (
		<TourCallout
			step={step}
			at={tour.current}
			count={tour.steps.length}
			labels={tour.labels}
			element={element}
			gaveUp={gaveUp}
			onNext={next}
			onSkip={dismiss}
		/>
	);
}

const pointed = new Set<string>();

function PointAt({ pointer }: { pointer: Pointer }) {
	const anchor = isAnchor(pointer.anchor) ? pointer.anchor : undefined;
	const element = useAnchorElement(anchor);
	const gaveUp = useGaveUp(element === undefined);
	useReportMissing(anchor, gaveUp);
	const [over, setOver] = useState(false);
	const finished = over || gaveUp;
	useReveal({ anchor });
	const finish = useCallback(() => setOver(true), []);
	useEffect(() => {
		if (!finished) return;
		pointed.add(pointer._id);
		if (pointer.open !== undefined && isPage(pointer.open))
			openBeside(pageContent(pointer.open));
	}, [finished, pointer._id, pointer.open]);
	if (finished || element === undefined) return null;
	return (
		<TourPointer
			element={element}
			mark={pointer.mark}
			size={pointer.size}
			click={pointer.click}
			seed={pointer._id}
			onDone={finish}
		/>
	);
}

function Pointing() {
	const { data: pointer } = useQuery(convexQuery(api.tours.pointer, {}));
	if (pointer === undefined || pointer === null || pointed.has(pointer._id))
		return null;
	return <PointAt key={pointer._id} pointer={pointer} />;
}

export function Onboarding() {
	const { data: tour } = useQuery(convexQuery(api.tours.active, {}));
	useUnpointableWarning(import.meta.env.DEV);
	return (
		<>
			{tour !== undefined && tour !== null && (
				<TourStep key={`${tour._id}:${tour.current}`} tour={tour} />
			)}
			<Pointing />
		</>
	);
}
