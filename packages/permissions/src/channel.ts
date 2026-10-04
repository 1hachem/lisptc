import { topic } from "@repo/interpreter/channels";
import type { ApprovalRequest } from "./ports.ts";

export const requested = topic<ApprovalRequest>("permissions");

export const decided = topic<string>("permissions-decided");
