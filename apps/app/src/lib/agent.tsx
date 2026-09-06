import type { ExpressionId, StateId } from "@repo/bloub";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useChatSession } from "./chat.tsx";

interface Mood {
	state: StateId;
	label: string;
}

const MOODS = {
	failed: { state: "exclaim", label: "the agent errored" },
	thinking: { state: "thinking", label: "the agent is thinking" },
	busy: { state: "idle", label: "the agent is answering" },
	idle: { state: "idle", label: "the agent is idle" },
} satisfies Record<string, Mood>;

type MoodId = keyof typeof MOODS;

const REST_FACE: ExpressionId = "surpris";

const FACES: readonly ExpressionId[] = ["fier", "timide", "blase"];

const FACE_MS = 8000;

const LINE_MS = 4000;

export interface Utterance {
	line?: string;
	face?: ExpressionId;
}

export interface Muttering {
	line: string;
	at: number;
}

interface Agent extends Mood {
	mood: MoodId;
	face: ExpressionId;
	muttering: Muttering | null;
	say: (utterance: Utterance) => void;
	settle: () => void;
}

const AgentContext = createContext<Agent | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
	const { messages, isLoading, error, fresh } = useChatSession();

	const last = messages[messages.length - 1];
	const deciding =
		isLoading && (!last || last.type === "human" || last.type === "user");

	const mood: MoodId = error
		? "failed"
		: deciding
			? "thinking"
			: isLoading
				? "busy"
				: "idle";

	const [face, setFace] = useState<ExpressionId>(REST_FACE);
	const [muttering, setMuttering] = useState<Muttering | null>(null);
	const faceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const next = useRef(0);
	const was = useRef(false);

	useEffect(
		() => () => {
			if (faceTimer.current) clearTimeout(faceTimer.current);
			if (lineTimer.current) clearTimeout(lineTimer.current);
		},
		[],
	);

	const wear = useCallback((expression: ExpressionId) => {
		setFace(expression);
		if (faceTimer.current) clearTimeout(faceTimer.current);
		faceTimer.current = setTimeout(() => setFace(REST_FACE), FACE_MS);
	}, []);

	const say = useCallback(
		({ line, face: expression }: Utterance) => {
			if (line !== undefined) {
				if (lineTimer.current) clearTimeout(lineTimer.current);
				setMuttering({ line, at: Date.now() });
			}
			if (expression) wear(expression);
		},
		[wear],
	);

	const settle = useCallback(() => {
		if (lineTimer.current) clearTimeout(lineTimer.current);
		lineTimer.current = setTimeout(() => setMuttering(null), LINE_MS);
	}, []);

	useEffect(() => {
		const finished = was.current && !isLoading;
		was.current = isLoading;
		if (!finished) return;
		wear(FACES[next.current % FACES.length]);
		next.current += 1;
	}, [isLoading, wear]);

	useEffect(() => {
		if (!fresh) return;
		setFace(REST_FACE);
		setMuttering(null);
	}, [fresh]);

	const value: Agent = {
		mood,
		...MOODS[mood],
		face,
		muttering,
		say,
		settle,
	};

	return (
		<AgentContext.Provider value={value}>{children}</AgentContext.Provider>
	);
}

export function useAgent(): Agent {
	const ctx = useContext(AgentContext);
	if (!ctx) throw new Error("useAgent must be used within an AgentProvider");
	return ctx;
}
