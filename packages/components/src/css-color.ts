export function cssColorHex(css: string): number | undefined {
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return undefined;
	context.fillStyle = css;
	context.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
	if (a === 0) return undefined;
	return (r << 16) | (g << 8) | b;
}
