import type { ReactNode } from "react";
import { callOf, type Datum, plainText, readForm } from "../lib/form-reader.ts";

export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1.5 border-bg2 border-t pt-3">
			<div className="flex items-baseline gap-3">
				<span className="flex-1 text-[11px] text-dim uppercase tracking-[0.14em]">
					{label}
				</span>
				{hint !== undefined && (
					<span className="flex-none text-[11px] text-dim">{hint}</span>
				)}
			</div>
			<div className="min-w-0 text-[12.5px] text-fg">{children}</div>
		</section>
	);
}

export function Chips({ items }: { items: readonly string[] }) {
	if (items.length === 0) return <span className="text-dim">none</span>;
	return (
		<div className="flex flex-wrap gap-1.5">
			{items.map((item) => (
				<span
					key={item}
					className="min-w-0 max-w-full truncate rounded-sm bg-bg2 px-1.5 py-0.5 font-mono text-[11.5px]"
				>
					{item}
				</span>
			))}
		</div>
	);
}

function isPlist(items: readonly Datum[]): boolean {
	return (
		items.length > 0 &&
		items.length % 2 === 0 &&
		items.every((item, i) => i % 2 === 1 || item.kind === "keyword")
	);
}

function DatumView({ datum }: { datum: Datum }) {
	switch (datum.kind) {
		case "string":
			return (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{datum.value}
				</p>
			);
		case "number":
			return <span className="font-mono">{datum.value}</span>;
		case "symbol":
			return <span className="break-words font-mono">{datum.name}</span>;
		case "keyword":
			return <span className="font-mono text-dim">{datum.name}</span>;
		case "list":
			if (isPlist(datum.items))
				return (
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
						{datum.items.map((item, i) =>
							i % 2 === 0 ? (
								<dt key={`k${String(i)}`} className="text-dim">
									{plainText(item)}
								</dt>
							) : (
								<dd key={`v${String(i)}`} className="min-w-0">
									<DatumView datum={item} />
								</dd>
							),
						)}
					</dl>
				);
			return <Chips items={datum.items.map(plainText)} />;
	}
}

export function SourceValue({ source }: { source: string }) {
	const datum = readForm(source);
	if (datum === undefined)
		return (
			<p className="whitespace-pre-wrap break-words leading-relaxed">
				{source}
			</p>
		);
	return <DatumView datum={datum} />;
}

const EFFECTS: Record<string, { label: string; means: string }> = {
	"permission/allow": { label: "allow", means: "runs without asking" },
	"permission/deny": { label: "deny", means: "always refused" },
	"permission/ask": { label: "ask", means: "waits for your approval" },
	"permission/default": {
		label: "default",
		means: "applies to every call no other rule names",
	},
	"permission/server": {
		label: "server",
		means: "which of this MCP server's tools load",
	},
	"permission/deny-server": {
		label: "deny server",
		means: "every tool of this MCP server is refused",
	},
	"permission/hide-server": {
		label: "hide server",
		means: "this MCP server is never loaded",
	},
};

export function RuleCard({ source }: { source: string }) {
	const call = callOf(readForm(source));
	const effect =
		call === undefined
			? undefined
			: (EFFECTS[call.head] ?? {
					label: call.head.replace(/^permission\//, ""),
					means: "",
				});
	if (call === undefined || effect === undefined)
		return <span className="text-dim">this rule could not be read</span>;
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline gap-2">
				<span className="flex-none rounded-sm bg-bg2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg">
					{effect.label}
				</span>
				<span className="min-w-0 truncate text-dim">{effect.means}</span>
			</div>
			<div className="flex flex-col gap-1">
				{call.args.map((arg, i) => (
					<div key={`${String(i)}-${plainText(arg)}`} className="min-w-0">
						{arg.kind === "list" && arg.items[0]?.kind === "symbol" ? (
							<div className="flex items-baseline gap-2">
								<span className="flex-none text-dim">
									{plainText(arg.items[0])}
								</span>
								<Chips items={arg.items.slice(1).map(plainText)} />
							</div>
						) : (
							<Chips items={[plainText(arg)]} />
						)}
					</div>
				))}
			</div>
		</div>
	);
}
