import { AsciiScene, alpineDawn } from "@repo/ui";

export function LoadingScene() {
	return (
		<div className="fixed inset-0 flex items-center justify-center bg-bg">
			<div className="w-[min(100vw,200vh)]">
				<AsciiScene piece={alpineDawn} />
			</div>
		</div>
	);
}
