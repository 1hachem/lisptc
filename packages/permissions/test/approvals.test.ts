import { describe, expect, it } from "vitest";
import { MemoryApprovals } from "../src/approvals.ts";
import type { ApprovalRequest, Decision } from "../src/ports.ts";

const request = (id: string, name: string): ApprovalRequest => ({
	id,
	name,
	args: "",
	at: 0,
});

describe("MemoryApprovals", () => {
	it("tells every resolved listener once per resolve, with the request and the decision", () => {
		const approvals = new MemoryApprovals();
		const heard: [ApprovalRequest, Decision][] = [];
		const also: string[] = [];
		approvals.onResolved((r, d) => {
			heard.push([r, d]);
			return undefined;
		});
		approvals.onResolved((r) => {
			also.push(r.id);
			return undefined;
		});
		const first = request("a", "string-upcase");
		const second = request("b", "eval");
		approvals.open(first);
		approvals.open(second);

		const approve: Decision = {
			id: "a",
			approved: true,
			scope: "once",
			by: "ui",
		};
		const deny: Decision = {
			id: "b",
			approved: false,
			scope: "once",
			by: "ui",
		};
		expect(approvals.resolve(approve)).toEqual({ request: first });
		expect(approvals.resolve(deny)).toEqual({ request: second });
		expect(approvals.resolve(approve)).toBeUndefined();
		expect(approvals.resolve({ ...deny, id: "never" })).toBeUndefined();

		expect(heard).toEqual([
			[first, approve],
			[second, deny],
		]);
		expect(also).toEqual(["a", "b"]);
	});

	it("settles with the refusal a listener reports", () => {
		const approvals = new MemoryApprovals();
		approvals.onResolved(() => "it changes nothing");
		approvals.onResolved(() => undefined);
		const held = request("a", "(permission/clear-all)");
		approvals.open(held);
		expect(
			approvals.resolve({ id: "a", approved: true, scope: "once", by: "ui" }),
		).toEqual({ request: held, refused: "it changes nothing" });
	});

	it("records the grant before a listener hears of it", () => {
		const approvals = new MemoryApprovals();
		const seen: boolean[] = [];
		approvals.onResolved((r) => {
			seen.push(approvals.granted(r.name));
			return undefined;
		});
		approvals.open(request("a", "string-upcase"));
		approvals.resolve({ id: "a", approved: true, scope: "once", by: "ui" });
		expect(seen).toEqual([true]);
	});
});
