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
import { PermissionRequest } from "../src/components/permission-request.tsx";
import {
	type ApprovalOutcome,
	type ApprovalTransport,
	approvalDecisions,
} from "../src/lib/approvals.ts";

const session = vi.hoisted(() => ({ chatId: "c1", send: vi.fn() }));

vi.mock("../src/lib/chat.tsx", () => ({
	useChatSession: <U,>(selector: (state: typeof session) => U): U =>
		selector(session),
}));

vi.mock("../src/lib/analytics.tsx", () => ({ reportIssue: vi.fn() }));
vi.mock("../src/lib/ui-action.ts", () => ({ postUiAction: vi.fn() }));

const REQUEST = { id: "r1", name: "(permission/deny eval)", args: "" };
const MESSAGE_ID = "w1";
const KEY = convexQuery(api.messages.transcript, {
	chatId: session.chatId as Id<"chats">,
}).queryKey;

interface Row {
	_id: string;
	wireId?: string;
	kwargs?: Record<string, unknown>;
}

function transcript(decided?: boolean): Row[] {
	return [
		{
			_id: "row1",
			wireId: MESSAGE_ID,
			kwargs: {
				permissions: {
					requests: [REQUEST],
					...(decided === undefined
						? {}
						: { decided: { [REQUEST.id]: decided } }),
				},
			},
		},
	];
}

function StoredCard({ transport }: { transport?: ApprovalTransport }) {
	const { data } = useQuery<Row[]>({ queryKey: KEY, queryFn: skipToken });
	const row = data?.find((r) => (r.wireId ?? r._id) === MESSAGE_ID);
	return (
		<PermissionRequest
			request={REQUEST}
			messageId={MESSAGE_ID}
			decided={approvalDecisions(row?.kwargs?.permissions).get(REQUEST.id)}
			transport={transport}
		/>
	);
}
const CHOICES = ["Deny", "Allow for session", "Allow once"];

beforeAll(() => {
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

beforeEach(() => {
	session.send.mockReset();
});

afterEach(() => {
	for (const root of roots.splice(0)) act(() => root.unmount());
	document.body.replaceChildren();
});

function transportResolving(outcome: ApprovalOutcome): ApprovalTransport {
	return { decide: vi.fn(async () => outcome) };
}

function clientHolding(rows: Row[]): QueryClient {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(KEY, rows);
	return client;
}

async function mount(client: QueryClient, transport?: ApprovalTransport) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<StoredCard transport={transport} />
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
	transport: ApprovalTransport;
	resolve: (outcome: ApprovalOutcome) => void;
} {
	let resolve: (outcome: ApprovalOutcome) => void = () => {};
	const transport: ApprovalTransport = {
		decide: vi.fn(
			() =>
				new Promise<ApprovalOutcome>((done) => {
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
			permissions: { requests: [REQUEST], decided: { [REQUEST.id]: true } },
		});
		expect(transport.decide).toHaveBeenCalledWith("c1", MESSAGE_ID, REQUEST, {
			approved: true,
			scope: "once",
		});
		expect(session.send).not.toHaveBeenCalled();

		await act(async () => {
			resolve({ ok: true, message: "I approved (permission/deny eval)" });
		});

		expect(session.send).toHaveBeenCalledTimes(1);
		expect(session.send).toHaveBeenCalledWith(
			"I approved (permission/deny eval)",
		);
		expect(card.text()).toContain("Allowed");
	});

	it("drives the next turn on a denial too, once", async () => {
		const client = clientHolding(transcript());
		const transport = transportResolving({
			ok: true,
			message: "I denied (permission/deny eval)",
		});
		const card = await mount(client, transport);

		await card.click("Deny");

		expect(card.text()).toContain("Denied");
		expect(card.buttons()).toEqual([]);
		expect(transport.decide).toHaveBeenCalledWith("c1", MESSAGE_ID, REQUEST, {
			approved: false,
			scope: "once",
		});
		expect(session.send).toHaveBeenCalledTimes(1);
		expect(session.send).toHaveBeenCalledWith(
			"I denied (permission/deny eval)",
		);
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
		expect(transport.decide).not.toHaveBeenCalled();
		expect(session.send).not.toHaveBeenCalled();
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
		expect(session.send).not.toHaveBeenCalled();
	});

	it("rolls the message back and keeps the buttons when the request fails", async () => {
		const client = clientHolding(transcript());
		const card = await mount(client, {
			decide: vi.fn(async () => {
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
