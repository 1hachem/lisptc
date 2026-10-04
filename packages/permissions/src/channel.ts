import { topic } from "@repo/interpreter/channels";
import type { ApprovalRequest } from "./ports.ts";

export const requested = topic<ApprovalRequest>("permissions");

export const decided = topic<string>("permissions-decided");

export const settled = topic<{ id: string; approved: boolean }>(
	"permissions-settled",
);
