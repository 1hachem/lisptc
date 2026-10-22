import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import { MessageMemories } from "@repo/components";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CHANNELS, EVERY_CHANNEL, type Shown } from "../lib/channels.ts";
import {
	type ChatMessage,
	isSystemMessage,
	isToolMessage,
	stepMeta,
	toChatMessages,
} from "../lib/chat.tsx";
import { useModelPicker } from "../lib/model-picker.tsx";
import {
	stepHolding,
	type TraceEntry,
	type TraceStep,
	traceEntries,
} from "../lib/trace-steps.ts";
import { formatElapsed } from "../lib/turn-timeline.ts";
import { useUI } from "../lib/ui.tsx";
import {
	ChannelsShown,
	ChatLine,
	SystemLine,
	ToolMessage,
} from "./chat-view.tsx";
import { MessageMeta } from "./message-meta.tsx";

function ChannelToggles({
	shown,
	toggle,
}: {
	shown: Shown;
	toggle: (id: keyof Shown) => void;
}) {
	return (
		<div className="flex flex-wrap gap-x-3 gap-y-1 border-dim/20 border-b px-4 py-1.5 text-[11px]">
			{CHANNELS.map((c) => (
				<button
					key={c.id}
					type="button"
					aria-pressed={shown[c.id]}
					title={c.hint}
					onClick={() => toggle(c.id)}
					className={`flex items-center gap-1.5 tracking-[0.1em] ${
						shown[c.id] ? c.text : "text-dim/50 hover:text-dim"
					}`}
				>
					<span
						aria-hidden
						className={`size-1.5 flex-none rounded-full ${
							shown[c.id] ? c.dot : "bg-dim/30"
						}`}
					/>
					{c.label}
				</button>
			))}
		</div>
	);
}

function TraceLine({
	message,
	index,
}: {
	message: ChatMessage;
	index: number;
}) {
	const { metaShown } = useUI();
	const { openModelPicker } = useModelPicker();
	const stats = useMemo(() => stepMeta(message), [message]);
	return (
		<div className="group relative min-w-0 empty:hidden">
			{isToolMessage(message) ? (
				<ToolMessage message={message} />
			) : (
				<ChatLine message={message} index={index} busy={false} />
			)}
			{stats?.memories && <MessageMemories memories={stats.memories} />}
			{stats && (
				<MessageMeta
					meta={stats}
					show={metaShown}
					onPickModel={openModelPicker}
				/>
			)}
		</div>
	);
}

function useScrollTo(
	scroller: React.RefObject<HTMLDivElement | null>,
	target: string | undefined,
	loaded: boolean,
) {
	useEffect(() => {
		if (target === undefined || !loaded) return;
		const lines =
			scroller.current?.querySelectorAll<HTMLElement>("[data-message-id]");
		const found = [...(lines ?? [])].find(
			(line) => line.dataset.messageId === target,
		);
		found?.scrollIntoView?.({ block: "start" });
	}, [scroller, target, loaded]);
}

const FLASH_MS = 1600;

function useFlash(target: string | undefined): string | undefined {
	const [flashing, setFlashing] = useState(target);
	useEffect(() => {
		setFlashing(target);
		if (target === undefined) return;
		const timer = setTimeout(() => setFlashing(undefined), FLASH_MS);
		return () => clearTimeout(timer);
	}, [target]);
	return flashing;
}

function useOpenSteps(entries: readonly TraceEntry[], target?: string) {
	const [overrides, setOverrides] = useState<Record<string, boolean>>({});
	const targeted = stepHolding(entries, target);
	useEffect(() => {
		if (targeted === undefined) return;
		setOverrides((was) => {
			if (!(targeted in was)) return was;
			const { [targeted]: _, ...rest } = was;
			return rest;
		});
	}, [targeted]);
	const isOpen = (step: string) => overrides[step] ?? step === targeted;
	const toggle = (step: string) =>
		setOverrides((was) => ({ ...was, [step]: !isOpen(step) }));
	return { isOpen, toggle };
}

function StepHeader({
	step,
	open,
	toggle,
}: {
	step: TraceStep;
	open: boolean;
	toggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-expanded={open}
			data-step-header
			onClick={toggle}
			className="flex w-full min-w-0 items-center gap-2 text-left text-[11.5px] text-dim hover:text-fg"
		>
			<span aria-hidden className="w-2 flex-none">
				{open ? "▾" : "▸"}
			</span>
			<span className="flex-none">step {step.number}</span>
			<span className="min-w-0 truncate text-fg">{step.title}</span>
			<span
				className={`ml-auto flex-none ${step.failed ? "text-red" : "text-green"}`}
			>
				{step.failed ? "failed" : "ok"}
			</span>
			{step.durationMs !== undefined && (
				<span className="flex-none tabular-nums">
					{formatElapsed(step.durationMs)}
				</span>
			)}
		</button>
	);
}

function TracedMessage({
	message,
	flashing,
	children,
}: {
	message: ChatMessage;
	flashing: string | undefined;
	children: React.ReactNode;
}) {
	const flashed = message.id !== undefined && message.id === flashing;
	return (
		<div
			data-message-id={message.id}
			data-flash={flashed || undefined}
			className={`min-w-0 transition-colors duration-700 empty:hidden ${
				flashed ? "bg-yellow/10" : ""
			}`}
		>
			{children}
		</div>
	);
}

export function TraceLines({
	messages,
	turn,
}: {
	messages: readonly ChatMessage[];
	turn?: string;
}) {
	const [shown, setShown] = useState<Shown>(EVERY_CHANNEL);
	const scroller = useRef<HTMLDivElement>(null);
	const entries = useMemo(() => traceEntries(messages), [messages]);
	const { isOpen, toggle: toggleStep } = useOpenSteps(entries, turn);
	const flashing = useFlash(turn);
	useScrollTo(scroller, turn, messages.length > 0);
	const toggle = (id: keyof Shown) =>
		setShown((was) => ({ ...was, [id]: !was[id] }));
	return (
		<ChannelsShown shown={shown}>
			<div className="flex h-full min-h-0 flex-col">
				<ChannelToggles shown={shown} toggle={toggle} />
				<div
					ref={scroller}
					className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-4"
				>
					<div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
						{entries.map((entry) => {
							if (entry.kind === "message") {
								const { message, at } = entry;
								return (
									<TracedMessage
										key={message.id ?? at}
										message={message}
										flashing={flashing}
									>
										{isSystemMessage(message) ? (
											shown.system && <SystemLine message={message} />
										) : (
											<TraceLine message={message} index={at} />
										)}
									</TracedMessage>
								);
							}
							const { step } = entry;
							const open = isOpen(step.id);
							return (
								<div
									key={step.id}
									data-step={step.number}
									className="flex min-w-0 flex-col gap-2"
								>
									<StepHeader
										step={step}
										open={open}
										toggle={() => toggleStep(step.id)}
									/>
									{open &&
										step.messages.map((message, at) => (
											<TracedMessage
												key={message.id ?? at}
												message={message}
												flashing={flashing}
											>
												<TraceLine message={message} index={at} />
											</TracedMessage>
										))}
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</ChannelsShown>
	);
}

export function TraceView({ chatId, turn }: { chatId: string; turn?: string }) {
	const { data } = useQuery(
		convexQuery(api.messages.transcript, { chatId: chatId as Id<"chats"> }),
	);
	const messages = useMemo(() => toChatMessages(data ?? []), [data]);
	return <TraceLines messages={messages} turn={turn} />;
}
