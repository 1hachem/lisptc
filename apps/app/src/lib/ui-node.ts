import { z } from "zod";

export const viewNode = z.object({
	tag: z.string(),
	props: z.record(z.string(), z.json()),
	get children() {
		return z.array(viewNode);
	},
});

export type ViewNode = z.infer<typeof viewNode>;
