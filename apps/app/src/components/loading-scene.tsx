import { AsciiScene, alpineDawn } from "@repo/ui";
import { type ReactNode, useEffect, useState } from "react";

const SCENE_MIN_MS = 2000;

export function LoadingScene() {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-bg">
			<div className="w-[min(100vw,200vh)]">
				<AsciiScene piece={alpineDawn} />
			</div>
		</div>
	);
}

export function LoadingGate({
	loading,
	children,
}: {
	loading: boolean;
	children: ReactNode;
}) {
	const [held, setHeld] = useState(true);

	useEffect(() => {
		const timer = setTimeout(() => setHeld(false), SCENE_MIN_MS);
		return () => clearTimeout(timer);
	}, []);

	return (
		<>
			{loading ? null : children}
			{loading || held ? <LoadingScene /> : null}
		</>
	);
}
