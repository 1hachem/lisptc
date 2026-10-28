import { Unlink04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { GlyphCycle } from "@repo/components/glyph-cycle.tsx";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
	interface Window {
		lisptcDesktop?: { retry: () => void };
	}
}

const params = new URLSearchParams(location.search);
const target = params.get("target") ?? "";
const retrying = params.get("state") === "retry";

function retry(): void {
	window.lisptcDesktop?.retry();
}

function useOnline(): boolean {
	const [online, setOnline] = useState(navigator.onLine);
	useEffect(() => {
		const up = () => {
			setOnline(true);
			retry();
		};
		const down = () => setOnline(false);
		window.addEventListener("online", up);
		window.addEventListener("offline", down);
		return () => {
			window.removeEventListener("online", up);
			window.removeEventListener("offline", down);
		};
	}, []);
	return online;
}

function Unreachable() {
	const online = useOnline();
	return (
		<main className="loading">
			<HugeiconsIcon icon={Unlink04Icon} className="glyph" strokeWidth={1.5} />
			<p className="title">
				{online ? "cannot reach salsal" : "no internet connection"}
			</p>
			<p className="detail">
				{online
					? `${target ? `${target} is unreachable. ` : ""}retrying…`
					: "check your connection and try again."}
			</p>
			<button type="button" className="retry" onClick={retry}>
				retry
			</button>
		</main>
	);
}

function Loading() {
	if (retrying) return <Unreachable />;
	return (
		<main className="loading">
			<GlyphCycle label="loading" className="glyph" />
			<p className="title">salsal</p>
		</main>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Loading />);
