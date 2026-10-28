import { GlyphCycle } from "@repo/components/glyph-cycle.tsx";
import { createRoot } from "react-dom/client";

const params = new URLSearchParams(location.search);
const target = params.get("target") ?? "";
const retrying = params.get("state") === "retry";

function Loading() {
	return (
		<main className="loading">
			<GlyphCycle label={retrying ? "retrying" : "loading"} className="glyph" />
			<p className="title">{retrying ? "cannot reach lisptc" : "lisptc"}</p>
			{retrying && (
				<p className="detail">
					{target ? `${target} is unreachable. ` : ""}retrying…
				</p>
			)}
		</main>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Loading />);
