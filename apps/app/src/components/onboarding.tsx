import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { useSidebar } from "@repo/ui";
import { type AnchorId, anchors, isAnchor, isPage } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { reportIssue } from "../lib/analytics.tsx";
import { useAnchorElement } from "../lib/anchors.ts";
import { postMessage } from "../lib/chat.tsx";
import { type PanelContent, panelTab } from "../lib/panel-ops.ts";
import { requestPanelOps } from "../lib/panel-requests.ts";
import { pageContent, reveal } from "../lib/tour-layout.ts";
import { postUiAction } from "../lib/ui-action.ts";
import { TourCallout } from "./tour-callout.tsx";
import { openFolderOnMount } from "./workspace-tree.tsx";

type Tour = NonNullable<FunctionReturnType<typeof api.tours.active>>;

type Step = Tour["steps"][number];

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

function useReveal(step: Step | undefined): void {
	const { setOpen } = useSidebar();
	const page = step?.page;
	const anchor = step?.anchor;
	useEffect(() => {
		if (page !== undefined && isPage(page)) openBeside(pageContent(page));
		if (anchor === undefined || !isAnchor(anchor)) return;
		reveal(anchors[anchor].location, {
			openSidebar: () => setOpen(true),
			openFolder: (folder) => openFolderOnMount(folder as "knowledge"),
			openPage: openBeside,
		});
	}, [page, anchor, setOpen]);
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
	const advance = useConvexMutation(api.tours.advance);
	const skip = useConvexMutation(api.tours.skip);
	const last = tour.current + 1 >= tour.steps.length;
	useReveal(step);

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
			element={element}
			gaveUp={gaveUp}
			onNext={next}
			onSkip={dismiss}
		/>
	);
}

export function Onboarding() {
	const { data: tour } = useQuery(convexQuery(api.tours.active, {}));
	if (tour === undefined || tour === null) return null;
	return <TourStep key={`${tour._id}:${tour.current}`} tour={tour} />;
}
