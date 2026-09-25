import type { ReactNode } from "react";

export function Frame({
	name,
	tags,
	why,
	finding,
	spec,
	compact = false,
	children,
}: {
	name: string;
	tags: string[];
	why: ReactNode;
	finding?: ReactNode;
	spec: { input: ReactNode; ceiling: ReactNode; fails: ReactNode };
	compact?: boolean;
	children: ReactNode;
}) {
	return (
		<figure className="m-0 min-w-0 border border-bg2 bg-bg1">
			<header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-bg2 border-b px-4 py-3">
				<h3 className="m-0 text-[15px] text-fg">{name}</h3>
				{tags.map((tag) => (
					<span
						className="border border-bg2 px-1.5 py-0.5 text-[10.5px] text-dim uppercase tracking-wider"
						key={tag}
					>
						{tag}
					</span>
				))}
			</header>
			{compact ? null : (
				<p className="m-0 max-w-[74ch] px-4 pt-3 text-[13.5px] text-dim">
					{why}
				</p>
			)}
			<div className="overflow-x-auto px-3 py-3">{children}</div>
			{finding === undefined ? null : (
				<div className="mx-4 mb-4 border-blue border-l-2 bg-bg px-3 py-2.5 text-[13px] text-dim">
					{finding}
				</div>
			)}
			{compact ? null : (
				<dl className="m-0 grid gap-px border-bg2 border-t bg-bg2 sm:grid-cols-3">
					<Spec term="input">{spec.input}</Spec>
					<Spec term="holds up to">{spec.ceiling}</Spec>
					<Spec term="fails when">{spec.fails}</Spec>
				</dl>
			)}
		</figure>
	);
}

function Spec({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div className="bg-bg1 px-4 py-2.5">
			<dt className="m-0 text-[10px] text-dim uppercase tracking-wider">
				{term}
			</dt>
			<dd className="m-0 mt-1 text-[12.5px] text-dim">{children}</dd>
		</div>
	);
}

export function Legend({
	items,
}: {
	items: { color: string; label: string; line?: boolean }[];
}) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-[12px] text-dim">
			{items.map((item) => (
				<span className="inline-flex items-center gap-1.5" key={item.label}>
					<i
						className={
							item.line === true ? "block h-[3px] w-4" : "block h-2.5 w-2.5"
						}
						style={{ background: item.color }}
					/>
					{item.label}
				</span>
			))}
		</div>
	);
}

export function Ramp({ low, high }: { low: string; high: string }) {
	return (
		<div className="flex items-center gap-2 px-1 pt-2 text-[11.5px] text-dim">
			<span>{low}</span>
			<span className="flex h-2.5 w-[120px] overflow-hidden">
				{[100, 200, 300, 400, 500, 600, 700].map((step) => (
					<b
						className="flex-1"
						key={step}
						style={{ background: `var(--q${step})` }}
					/>
				))}
			</span>
			<span>{high}</span>
		</div>
	);
}
