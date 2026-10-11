import type { Id, TableNames } from "@repo/backend/dataModel";
import { z } from "zod";

export function convexId<Table extends TableNames>() {
	return z.string().transform((value) => value as Id<Table>);
}
