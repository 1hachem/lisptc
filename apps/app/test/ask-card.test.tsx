// @vitest-environment happy-dom
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@repo/backend/api";
import type { Id } from "@repo/backend/dataModel";
import {
	QueryClient,
	QueryClientProvider,
	skipToken,
	useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { AskCard } from "../src/components/ask-card.tsx";
import {
	type Ask,
	type AskOutcome,
	type AskTransport,
	answersOf,
	asksOf,
} from "../src/lib/asks.ts";
import { OAUTH_AUTHORIZED_KEY } from "../src/lib/oauth-callback.ts";

const session = vi.hoisted(() => ({
	chatId: "c1",
	workspaceId: "ws1",
	send: vi.fn(),
	resume: vi.fn(),
}));

vi.mock("../src/lib/chat.tsx", () => ({
	useChatSession: <U,>(selector: (state: typeof session) => U): U =>
		selector(session),
}));

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/ui-action.ts", () => ({ postUiAction: vi.fn() }));

const decide = (approved: boolean, scope: string) => ({
	action: "permissions/decide",
	values: { id: "r1", approved, scope },
});

const REQUEST: Ask = {
	id: "r1",
	title: "(permission/deny eval)",
	prompt: "This call needs your approval.",
	choices: [
		{
			label: "Deny",
			done: "Denied",
			accepts: false,
			answer: decide(false, "once"),
		},
		{
			label: "Allow for session",
			done: "Allowed for session",
			accepts: true,
			answer: decide(true, "session"),
		},
		{
			label: "Allow once",
			done: "Allowed",
			accepts: true,
			answer: decide(true, "once"),
			primary: true,
		},
	],
};

const STATE = "378e720d-4dd0-41f9-a072-09eba84e7267";

const AUTHORIZE = {
	label: "Authorize",
	done: "Authorized",
	accepts: true,
	answer: {
		action: "mcp/authorize",
		values: { id: STATE, server: "linear", approved: true },
	},
	opens: `https://mcp.linear.app/authorize?response_type=code&state=${STATE}`,
	primary: true as const,
};

const SIGN_IN: Ask = {
	id: STATE,
	title: "linear",
	prompt: "linear needs you to sign in before the agent can use it.",
	choices: [AUTHORIZE],
};
const MESSAGE_ID = "w1";
const KEY = convexQuery(api.messages.transcript, {
	chatId: session.chatId as Id<"chats">,
}).queryKey;

interface Row {
	_id: string;
	wireId?: string;
	kwargs?: Record<string, unknown>;
}

function transcript(decided?: boolean, ask: Ask = REQUEST): Row[] {
	return [
		{
			_id: "row1",
			wireId: MESSAGE_ID,
			kwargs: {
				asks: {
					open: [ask],
					...(decided === undefined
						? {}
						: {
								answered: {
									[ask.id]: {
										accepted: decided,
										label: decided ? "Allowed" : "Denied",
									},
								},
							}),
				},
			},
		},
	];
}

function StoredCard({
	transport,
	ask = REQUEST,
}: {
	transport?: AskTransport;
	ask?: Ask;
}) {
	const { data } = useQuery<Row[]>({ queryKey: KEY, queryFn: skipToken });
	const row = data?.find((r) => (r.wireId ?? r._id) === MESSAGE_ID);
	return (
		<AskCard
			ask={ask}
			messageId={MESSAGE_ID}
			answered={answersOf(row?.kwargs).get(ask.id)}
			transport={transport}
		/>
	);
}
const CHOICES = ["Deny", "Allow for session", "Allow once"];

const APPROVED = {
	token: "t-approved",
	source: "permissions/decide",
	text: "I approved (permission/deny eval)",
};
const DENIED = {
	token: "t-denied",
	source: "permissions/decide",
	text: "I denied (permission/deny eval)",
};

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

beforeEach(() => {
	session.send.mockReset();
	session.resume.mockReset();
});

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

function transportResolving(outcome: AskOutcome): AskTransport {
	return { answer: vi.fn(async () => outcome) };
}

function clientHolding(rows: Row[]): QueryClient {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(KEY, rows);
	return client;
}

async function mount(
	client: QueryClient,
	transport?: AskTransport,
	ask: Ask = REQUEST,
) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<StoredCard transport={transport} ask={ask} />
			</QueryClientProvider>,
		);
	});
	return {
		text: () => host.textContent ?? "",
		buttons: () =>
			[...host.querySelectorAll("button")].map((b) => b.textContent),
		async click(label: string) {
			const button = [...host.querySelectorAll("button")].find(
				(b) => b.textContent === label,
			);
			if (!button) throw new Error(`no ${label} button`);
			await act(async () => {
				button.click();
			});
			await act(async () => {
				await new Promise((done) => setTimeout(done, 0));
			});
		},
		unmount() {
			roots.splice(roots.indexOf(root), 1);
			act(() => root.unmount());
			host.remove();
		},
	};
}

function pending(): {
	transport: AskTransport;
	resolve: (outcome: AskOutcome) => void;
} {
	let resolve: (outcome: AskOutcome) => void = () => {};
	const transport: AskTransport = {
		answer: vi.fn(
			() =>
				new Promise<AskOutcome>((done) => {
					resolve = done;
				}),
		),
	};
	return { transport, resolve: (outcome) => resolve(outcome) };
}

describe("the approval card", () => {
	it("flips on the optimistic update to its message before the reply lands", async () => {
		const client = clientHolding(transcript());
		const { transport, resolve } = pending();
		const card = await mount(client, transport);
		expect(card.buttons()).toEqual(CHOICES);

		await card.click("Allow once");

		expect(card.text()).toContain("Allowed");
		expect(card.buttons()).toEqual([]);
		expect(client.getQueryData<Row[]>(KEY)?.[0].kwargs).toEqual({
			asks: {
				open: [REQUEST],
				answered: { [REQUEST.id]: { accepted: true, label: "Allowed" } },
			},
		});
		expect(transport.answer).toHaveBeenCalledWith(
			"c1",
			MESSAGE_ID,
			REQUEST.choices[2],
		);
		expect(session.resume).not.toHaveBeenCalled();

		await act(async () => {
			resolve({ ok: true, event: APPROVED });
		});

		expect(session.resume).toHaveBeenCalledTimes(1);
		expect(session.resume).toHaveBeenCalledWith(APPROVED);
		expect(session.send).not.toHaveBeenCalled();
		expect(card.text()).toContain("Allowed");
	});

	it("drives the next turn on a denial too, once", async () => {
		const client = clientHolding(transcript());
		const transport = transportResolving({ ok: true, event: DENIED });
		const card = await mount(client, transport);

		await card.click("Deny");

		expect(card.text()).toContain("Denied");
		expect(card.buttons()).toEqual([]);
		expect(transport.answer).toHaveBeenCalledWith(
			"c1",
			MESSAGE_ID,
			REQUEST.choices[0],
		);
		expect(session.resume).toHaveBeenCalledTimes(1);
		expect(session.resume).toHaveBeenCalledWith(DENIED);
		expect(session.send).not.toHaveBeenCalled();
	});

	it("stays decided on a remount that reads the patched message", async () => {
		const transport = transportResolving({ ok: true });
		const card = await mount(clientHolding(transcript(false)), transport);

		expect(card.text()).toContain("Denied");
		expect(card.buttons()).toEqual([]);

		card.unmount();
		const remounted = await mount(clientHolding(transcript(false)), transport);

		expect(remounted.text()).toContain("Denied");
		expect(remounted.buttons()).toEqual([]);
		expect(transport.answer).not.toHaveBeenCalled();
		expect(session.resume).not.toHaveBeenCalled();
	});

	it("rolls the message back and closes on a refused decision", async () => {
		const client = clientHolding(transcript());
		const card = await mount(
			client,
			transportResolving({
				ok: false,
				error: "this session is no longer live",
			}),
		);

		await card.click("Allow once");

		expect(card.text()).toContain("this session is no longer live");
		expect(card.text()).not.toContain("Allowed");
		expect(card.buttons()).toEqual([]);
		expect(client.getQueryData<Row[]>(KEY)).toEqual(transcript());
		expect(session.resume).not.toHaveBeenCalled();
	});

	it("rolls the message back and keeps the buttons when the request fails", async () => {
		const client = clientHolding(transcript());
		const card = await mount(client, {
			answer: vi.fn(async () => {
				throw new Error("network down");
			}),
		});

		await card.click("Deny");

		expect(card.text()).toContain("network down");
		expect(card.buttons()).toEqual(CHOICES);
		expect(client.getQueryData<Row[]>(KEY)).toEqual(transcript());
	});

	it("starts waiting when its message holds no decision", async () => {
		const card = await mount(
			clientHolding(transcript()),
			transportResolving({ ok: true }),
		);

		expect(card.text()).toContain("This call needs your approval.");
		expect(card.buttons()).toEqual(CHOICES);
	});
});

describe("a sign-in ask", () => {
	afterEach(() => localStorage.clear());

	it("opens the link and answers only once the sign-in came back", async () => {
		const opened = vi.spyOn(window, "open").mockReturnValue(null);
		const transport = transportResolving({ ok: true, event: APPROVED });
		const card = await mount(
			clientHolding(transcript(undefined, SIGN_IN)),
			transport,
			SIGN_IN,
		);

		await card.click("Authorize");

		expect(opened).toHaveBeenCalledWith(AUTHORIZE.opens, "_blank", "noopener");
		expect(transport.answer).not.toHaveBeenCalled();
		expect(card.text()).toContain("Finish in the tab that opened");

		await act(async () => {
			localStorage.setItem(OAUTH_AUTHORIZED_KEY, STATE);
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: OAUTH_AUTHORIZED_KEY,
					newValue: STATE,
				}),
			);
		});
		await act(async () => {
			await new Promise((done) => setTimeout(done, 0));
		});

		expect(transport.answer).toHaveBeenCalledWith("c1", MESSAGE_ID, AUTHORIZE);
		expect(session.resume).toHaveBeenCalledWith(APPROVED);
		expect(localStorage.getItem(OAUTH_AUTHORIZED_KEY)).toBe(null);
		opened.mockRestore();
	});

	it("answers on mount when the sign-in finished before the chat opened", async () => {
		localStorage.setItem(OAUTH_AUTHORIZED_KEY, STATE);
		const transport = transportResolving({ ok: true });
		await mount(
			clientHolding(transcript(undefined, SIGN_IN)),
			transport,
			SIGN_IN,
		);
		await act(async () => {
			await new Promise((done) => setTimeout(done, 0));
		});

		expect(transport.answer).toHaveBeenCalledWith("c1", MESSAGE_ID, AUTHORIZE);
	});
});

describe("reading an ask off a message", () => {
	it("keeps a choice that names no answered label, labelled by itself", () => {
		const { done: _done, ...bare } = AUTHORIZE;
		const [ask] = asksOf({
			asks: { open: [{ ...SIGN_IN, choices: [bare] }] },
		});
		expect(ask?.choices).toEqual([{ ...bare, done: "Authorize" }]);
	});
});
