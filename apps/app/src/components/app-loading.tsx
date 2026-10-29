import { GlyphCycle } from "@repo/components";

export function AppLoading() {
	return (
		<div className="flex h-full flex-1 items-center justify-center bg-bg text-dim">
			<GlyphCycle className="size-icon" />
		</div>
	);
}
