export interface Block {
	id: string;
	heading: string;
	text: string;
	line: number;
}

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*] /;
const TICKED = /`([^`\n]+)`/g;
const DRAWING = /[→←│┌└─|]/;
const LONGEST = 80;
const COMMANDS = 20;

interface Part {
	text: string;
	offset: number;
}

function split(lines: readonly string[]): Part[] {
	if (!BULLET.test(lines[0] ?? ""))
		return [{ text: lines.join("\n"), offset: 0 }];
	const parts: Part[] = [];
	for (const [i, line] of lines.entries()) {
		const last = parts[parts.length - 1];
		if (last === undefined || BULLET.test(line))
			parts.push({ text: line, offset: i });
		else last.text += `\n${line}`;
	}
	return parts;
}

export function chunk(markdown: string): Block[] {
	const lines = markdown.split("\n");
	const blocks: Block[] = [];
	const trail: string[] = [];
	let buffer: string[] = [];
	let start = 0;
	let fenced = false;

	const flush = (): void => {
		const raw = buffer;
		const at = start;
		buffer = [];
		if (raw.join("").trim() === "") return;
		for (const part of split(raw)) {
			const text = part.text.trim();
			if (text === "") continue;
			blocks.push({
				id: `b${blocks.length}`,
				heading: trail.filter((name) => name !== "").join(" > "),
				text,
				line: at + part.offset + 1,
			});
		}
	};

	for (const [i, line] of lines.entries()) {
		if (FENCE.test(line)) {
			if (buffer.length === 0) start = i;
			buffer.push(line);
			fenced = !fenced;
			if (!fenced) flush();
			continue;
		}
		if (fenced) {
			buffer.push(line);
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading !== null) {
			flush();
			const depth = heading[1].length;
			trail.length = depth - 1;
			for (let d = 0; d < depth - 1; d++)
				if (trail[d] === undefined) trail[d] = "";
			trail[depth - 1] = heading[2].trim();
			continue;
		}
		if (line.trim() === "") {
			flush();
			continue;
		}
		if (buffer.length === 0) start = i;
		buffer.push(line);
	}
	flush();
	return blocks;
}

function commands(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => !FENCE.test(line))
		.map((line) => line.split("#")[0].trim())
		.filter((line) => line !== "" && !DRAWING.test(line))
		.slice(0, COMMANDS);
}

export function mentions(block: Block): string[] {
	const found = [...block.text.matchAll(TICKED)].map((match) => match[1]);
	if (FENCE.test(block.text)) found.push(...commands(block.text));
	return [...new Set(found)].filter(
		(token) => token.trim() !== "" && token.length <= LONGEST,
	);
}
