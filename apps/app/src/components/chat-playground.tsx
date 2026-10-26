import type { Id } from "@repo/backend/dataModel";
import { Button } from "@repo/ui";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { create } from "zustand";
import { AgentProvider } from "../lib/agent.tsx";
import {
	type ChatMessage,
	type ChatSession,
	type ChatStore,
	ChatStoreProvider,
	stepMeta,
	useChatSession,
} from "../lib/chat.tsx";
import { ForkPickerProvider } from "../lib/fork-picker.tsx";
import { MockAgent, SCENARIOS } from "../lib/playground.ts";
import {
	applyWatched,
	readSse,
	shownMessages,
	UNWATCHED,
	type Watched,
} from "../lib/watch.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { ChatSurface } from "./chat-surface.tsx";
import { TraceLines } from "./trace-view.tsx";

const SPEEDS = [0.25, 1, 4] as const;

function useMockedFetch(agent: MockAgent) {
	useEffect(() => {
		const real = window.fetch;
		window.fetch = (input, init) => {
			const url = String(input instanceof Request ? input.url : input);
			return url.endsWith("/api/ui-action") || url.endsWith("/api/chat/steer")
				? agent.fetch(input, init)
				: real(input, init);
		};
		return () => {
			window.fetch = real;
		};
	}, [agent]);
}

async function played(
	turn: Response,
	update: (apply: (watched: Watched) => Watched) => void,
): Promise<void> {
	const reader = turn.body?.pipeThrough(new TextDecoderStream()).getReader();
	if (reader === undefined) return;
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		const { events, rest } = readSse(buffer + value);
		buffer = rest;
		update((watched) => events.reduce(applyWatched, watched));
	}
}

function useMockWatch(agent: MockAgent): Watched {
	const [watched, setWatched] = useState<Watched>(UNWATCHED);
	useEffect(
		() =>
			agent.follow((turn) => {
				setWatched((was) => ({
					...was,
					status: "running",
					failure: undefined,
				}));
				played(turn, setWatched)
					.catch((error: unknown) =>
						setWatched((was) => ({ ...was, failure: String(error) })),
					)
					.finally(() => setWatched((was) => ({ ...was, status: "idle" })));
			}),
		[agent],
	);
	return watched;
}

function useMockSession(
	agent: MockAgent,
	workspaceId: Id<"workspaces">,
): ChatStore {
	const watched = useMockWatch(agent);
	const [pending, setPending] = useState<ChatMessage | null>(null);
	const streamed = useMemo(() => shownMessages(watched), [watched]);
	const messages = useMemo(
		() =>
			pending === null || streamed.some((m) => m.id === pending.id)
				? streamed
				: [...streamed, pending],
		[streamed, pending],
	);
	const running = watched.status === "running";
	const storeRef = useRef<ChatStore | null>(null);
	storeRef.current ??= create<ChatSession>(() => ({
		messages: [],
		saved: [],
		queued: [],
		greeting: null,
		greetingTyped: false,
		meta: {},
		fresh: true,
		isLoading: false,
		chatId: null,
		draftChatId: null,
		workspaceId,
		send: async () => false,
		sendAbout: async () => false,
		stop: () => {},
		stopAll: () => {},
		withdraw: () => {},
		fail: () => {},
	}));
	const store = storeRef.current;

	useEffect(() => {
		const submit = async (text: string): Promise<boolean> => {
			if (running) return false;
			const id = crypto.randomUUID();
			setPending({ type: "human", content: text, id });
			await agent.fetch("/api/chat", {
				method: "POST",
				body: JSON.stringify({ input: { id, message: text } }),
			});
			return true;
		};
		const meta = Object.fromEntries(
			messages.flatMap((m) => {
				const found = stepMeta(m);
				return m.id && found ? [[m.id, found]] : [];
			}),
		);
		store.setState({
			messages,
			meta,
			fresh: messages.length === 0,
			isLoading: running,
			workspaceId,
			error: watched.failure,
			send: (text) => submit(text),
			sendAbout: (_file, text) => submit(text),
			stop: agent.stop,
			stopAll: agent.stop,
		});
	}, [store, agent, messages, running, watched.failure, workspaceId]);

	return store;
}

function Scenarios({ agent }: { agent: MockAgent }) {
	const { send, isLoading } = useChatSession((state) => ({
		send: state.send,
		isLoading: state.isLoading,
	}));
	return (
		<div className="flex flex-col gap-1">
			{SCENARIOS.map((scenario) => (
				<Button
					key={scenario.id}
					variant="outline"
					className="h-control justify-start"
					disabled={isLoading}
					onClick={() => {
						agent.queue(scenario.id);
						send(scenario.prompt);
					}}
				>
					{scenario.label}
				</Button>
			))}
		</div>
	);
}

function Trace({ agent }: { agent: MockAgent }) {
	const saved = useSyncExternalStore(agent.subscribe, agent.transcript);
	return <TraceLines messages={saved} />;
}

function Session({
	agent,
	workspaceId,
	traced,
	controls,
}: {
	agent: MockAgent;
	workspaceId: Id<"workspaces">;
	traced: boolean;
	controls: React.ReactNode;
}) {
	const store = useMockSession(agent, workspaceId);
	return (
		<ChatStoreProvider store={store}>
			<ForkPickerProvider onForked={() => {}}>
				<AgentProvider>
					<div className="flex h-full min-h-0 w-full min-w-0">
						<aside className="flex w-56 flex-none flex-col gap-4 overflow-y-auto border-dim/30 border-r p-3">
							<Scenarios agent={agent} />
							{controls}
						</aside>
						<main className="flex min-h-0 min-w-0 flex-1 flex-col">
							<ChatSurface
								toggle={null}
								trace={traced && <Trace agent={agent} />}
							/>
						</main>
					</div>
				</AgentProvider>
			</ForkPickerProvider>
		</ChatStoreProvider>
	);
}

export function ChatPlayground() {
	const { workspace } = useWorkspace();
	const agent = useMemo(() => new MockAgent(), []);
	const [generation, setGeneration] = useState(0);
	const [speed, setSpeed] = useState(1);
	const [traced, setTraced] = useState(true);
	useMockedFetch(agent);
	agent.speed = speed;

	if (!workspace) return null;

	const controls = (
		<div className="flex flex-col gap-2 text-dim text-xs">
			<div className="flex gap-1">
				{SPEEDS.map((value) => (
					<Button
						key={value}
						variant={value === speed ? "default" : "outline"}
						className="h-control flex-1"
						onClick={() => setSpeed(value)}
					>
						{value}×
					</Button>
				))}
			</div>
			<Button
				variant="outline"
				className="h-control"
				onClick={() => setTraced((shown) => !shown)}
			>
				{traced ? "hide trace" : "show trace"}
			</Button>
			<Button
				variant="outline"
				className="h-control"
				onClick={() => {
					agent.reset();
					setGeneration((n) => n + 1);
				}}
			>
				reset
			</Button>
		</div>
	);

	return (
		<Session
			key={generation}
			agent={agent}
			workspaceId={workspace._id}
			traced={traced}
			controls={controls}
		/>
	);
}
