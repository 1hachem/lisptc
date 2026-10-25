import {
	FetchStreamTransport,
	useStream,
} from "@langchain/langgraph-sdk/react";
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

function useMockSession(
	agent: MockAgent,
	workspaceId: Id<"workspaces">,
): ChatStore {
	const transport = useMemo(
		() => new FetchStreamTransport({ apiUrl: "/api/chat", fetch: agent.fetch }),
		[agent],
	);
	const stream = useStream({ transport });
	const messages: ChatMessage[] = stream.messages;
	const storeRef = useRef<ChatStore | null>(null);
	storeRef.current ??= create<ChatSession>(() => ({
		messages: [],
		saved: [],
		queued: [],
		greeting: null,
		meta: {},
		fresh: true,
		isLoading: false,
		chatId: null,
		draftChatId: null,
		workspaceId,
		send: () => Promise.resolve(false),
		sendAbout: () => Promise.resolve(false),
		resume: () => {},
		stop: () => {},
		withdraw: () => {},
		fail: () => {},
	}));
	const store = storeRef.current;

	useEffect(() => {
		const submit = async (
			input: Record<string, unknown>,
			shown: ChatMessage,
		): Promise<boolean> => {
			if (stream.isLoading) return false;
			stream.submit(input, {
				optimisticValues: { messages: [...messages, shown] },
			});
			return true;
		};
		const meta = Object.fromEntries(
			messages.flatMap((m) => {
				const found = stepMeta(m);
				return m.id && found ? [[m.id, found]] : [];
			}),
		);
		const error = stream.error
			? stream.error instanceof Error
				? stream.error.message
				: String(stream.error)
			: undefined;
		store.setState({
			messages,
			meta,
			fresh: messages.length === 0,
			isLoading: stream.isLoading,
			workspaceId,
			error,
			send: (text) =>
				submit(
					{ message: text },
					{ type: "human", content: text, id: crypto.randomUUID() },
				),
			sendAbout: (_file, text) =>
				submit(
					{ message: text },
					{ type: "human", content: text, id: crypto.randomUUID() },
				),
			resume: (event) =>
				submit(
					{ event: { token: event.token } },
					{
						type: "system",
						content: event.text,
						id: crypto.randomUUID(),
						additional_kwargs: { source: event.source },
					},
				),
			stop: () => void stream.stop(),
		});
	}, [store, stream, messages, workspaceId]);

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
