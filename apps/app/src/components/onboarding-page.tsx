import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { anchorOf } from "@repo/ui-catalog";
import { useQuery } from "@tanstack/react-query";
import { type TourStep, tourOf } from "../lib/onboarding-tour.ts";
import { PageView } from "./file-view.tsx";
import { Field, SourceValue } from "./read-only.tsx";

const STATUS: Record<"new" | "started" | "done", string> = {
	new: "not seen yet",
	started: "started, not finished",
	done: "done",
};

function StepItem({ step }: { step: TourStep }) {
	return (
		<li className="flex min-w-0 flex-col gap-1">
			<p className="whitespace-pre-wrap break-words leading-relaxed">
				{step.say === "" ? <span className="text-dim">no text</span> : step.say}
			</p>
			<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-dim">
				<span>
					{step.anchor === undefined
						? "shown in the middle"
						: `points at ${step.anchor}`}
				</span>
				{step.page !== undefined && <span>opens {step.page}</span>}
				<span>
					{step.waitsForClick ? "waits for a click" : "waits for next"}
				</span>
			</div>
		</li>
	);
}

function Script({ script }: { script: string }) {
	const tour = tourOf(script);
	if (tour === undefined)
		return (
			<Field label="runs" anchor={anchorOf("onboarding/script")}>
				<SourceValue source={script} />
			</Field>
		);
	return (
		<Field
			label="steps"
			hint={`${String(tour.steps.length)} in this tour`}
			anchor={anchorOf("onboarding/script")}
		>
			<ol className="flex list-decimal flex-col gap-3 pl-5 marker:text-dim">
				{tour.steps.map((step, i) => (
					<StepItem key={`${String(i)}-${step.say}`} step={step} />
				))}
			</ol>
		</Field>
	);
}

export function OnboardingPage({
	workspaceId,
	name,
}: {
	workspaceId: Id<"workspaces">;
	name: string;
}) {
	const { data: onboardings, error } = useQuery(
		convexQuery(api.onboardings.list, { workspaceId }),
	);
	if (error) throw error;
	const onboarding = onboardings?.find((candidate) => candidate.name === name);

	return (
		<PageView title={`onboarding/${name}`}>
			{onboarding === undefined ? (
				<div className="text-dim">
					{onboardings === undefined
						? "loading…"
						: `no onboarding named ${name}`}
				</div>
			) : (
				<div className="flex flex-col gap-4">
					<h1 className="break-words font-medium text-[15px] text-fg">
						{onboarding.name}
					</h1>
					{onboarding.about !== "" && (
						<Field label="about">
							<p className="whitespace-pre-wrap break-words leading-relaxed">
								{onboarding.about}
							</p>
						</Field>
					)}
					<Field label="your progress">
						<span className="text-dim">{STATUS[onboarding.status]}</span>
					</Field>
					<Script script={onboarding.script} />
				</div>
			)}
		</PageView>
	);
}
