import { Label, Panel, Summary, Tag, Tags, Turn } from "@/components/ui.tsx";
import type { CaseInfo } from "@/lib/reports.ts";

function Mock({ mock }: { mock: CaseInfo["mocks"][number] }) {
	return (
		<li>
			<span>{mock.name}</span>{" "}
			<span className="text-[12px] text-dim">
				{mock.tools.length} tool{mock.tools.length === 1 ? "" : "s"},{" "}
				{mock.answers.length} mocked
				{mock.connectDelayMs === undefined
					? ""
					: `, ${mock.connectDelayMs}ms connect`}
				{mock.fails === undefined ? "" : `, fails: ${mock.fails}`}
			</span>
			<Tags>
				{mock.answers.map((tool) => (
					<Tag key={tool}>{tool}</Tag>
				))}
			</Tags>
		</li>
	);
}

export function Setup({ info }: { info: CaseInfo }) {
	return (
		<Panel className="mb-3">
			<details>
				<Summary>
					how this is set up — optimal {info.min}, budget {info.max},{" "}
					{info.samples} sample{info.samples === 1 ? "" : "s"}, score ≥{" "}
					{info.minScore}, {info.systemPrompt} system prompt
				</Summary>

				<div className="border-bg2 border-t px-4 pb-3.5">
					<Label>seeded conversation</Label>
					{info.seed.length === 0 ? (
						<p className="text-[12px] text-dim">
							nothing seeded — the agent starts cold
						</p>
					) : (
						<div>
							{info.seed.map((turn) => (
								<Turn
									className="px-0 py-1"
									key={`${turn.role}-${turn.content}`}
									role={turn.role}
								>
									{turn.content}
								</Turn>
							))}
						</div>
					)}

					<Label>mocked servers</Label>
					{info.mocks.length === 0 ? (
						<p className="text-[12px] text-dim">
							none — nothing is stubbed for this case
						</p>
					) : (
						<ul className="m-0 grid list-none gap-2.5 p-0">
							{info.mocks.map((mock) => (
								<Mock key={mock.name} mock={mock} />
							))}
						</ul>
					)}

					<Label>checks</Label>
					<pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words border border-bg2 bg-bg2/40 p-3 font-mono text-[12.5px]">
						{info.checks}
					</pre>
				</div>
			</details>
		</Panel>
	);
}
