import ReactJsonView, { type ThemeObject } from "@microlink/react-json-view";

const THEME: ThemeObject = {
	base00: "transparent",
	base01: "var(--bg1)",
	base02: "var(--bg2)",
	base03: "var(--dim)",
	base04: "var(--dim)",
	base05: "var(--dim)",
	base06: "var(--fg)",
	base07: "var(--fg)",
	base08: "var(--red)",
	base09: "var(--green)",
	base0A: "var(--dim)",
	base0B: "var(--orange)",
	base0C: "var(--dim)",
	base0D: "var(--blue)",
	base0E: "var(--purple)",
	base0F: "var(--orange)",
};

export function parsedJson(
	text: string,
): { value: unknown } | { failure: string } {
	try {
		return { value: JSON.parse(text) };
	} catch (error) {
		return { failure: error instanceof Error ? error.message : String(error) };
	}
}

function Raw({ text }: { text: string }) {
	return (
		<pre className="whitespace-pre-wrap break-words font-mono">{text}</pre>
	);
}

export function JsonView({
	text,
	collapsed = 2,
}: {
	text: string;
	collapsed?: number;
}) {
	const parsed = parsedJson(text);
	if ("failure" in parsed)
		return (
			<div>
				<div className="text-red">not valid json: {parsed.failure}</div>
				<Raw text={text} />
			</div>
		);
	if (typeof parsed.value !== "object" || parsed.value === null)
		return <Raw text={text} />;
	return (
		<ReactJsonView
			collapsed={collapsed}
			displayDataTypes={false}
			name={false}
			showComma
			src={parsed.value}
			style={{ fontFamily: "var(--font-mono)" }}
			theme={THEME}
		/>
	);
}
