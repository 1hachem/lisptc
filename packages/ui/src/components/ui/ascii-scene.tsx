import { useEffect, useRef } from "react";
import { mount } from "../../ascii/mount.ts";
import type { Piece } from "../../ascii/types.ts";

export function AsciiScene({
	piece,
	className,
}: {
	piece: Piece;
	className?: string;
}) {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!ref.current) return;
		return mount(ref.current, piece);
	}, [piece]);

	return (
		<canvas
			ref={ref}
			role="img"
			aria-label={piece.meta.name}
			className={className}
		/>
	);
}
