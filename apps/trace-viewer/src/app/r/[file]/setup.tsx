import type { CaseInfo } from "@/lib/reports.ts";

function Mock({ mock }: { mock: CaseInfo["mocks"][number] }) {
	return (
		<li>
			<span className="mono">{mock.name}</span>{" "}
			<span className="dim small">
				{mock.tools.length} tool{mock.tools.length === 1 ? "" : "s"},{" "}
				{mock.answers.length} mocked
				{mock.connectDelayMs === undefined
					? ""
					: `, ${mock.connectDelayMs}ms connect`}
				{mock.fails === undefined ? "" : `, fails: ${mock.fails}`}
			</span>
			<div className="targets">
				{mock.answers.map((tool) => (
					<span className="tag mono" key={tool}>
						{tool}
					</span>
				))}
			</div>
		</li>
	);
}

export function Setup({ info }: { info: CaseInfo }) {
	return (
		<details className="setup">
			<summary>
				how this is set up — optimal {info.min}, budget {info.max},{" "}
				{info.samples} sample{info.samples === 1 ? "" : "s"}
				{info.passRate === undefined ? "" : `, pass rate ≥ ${info.passRate}`},{" "}
				{info.systemPrompt} system prompt
			</summary>

			<div className="setup-body">
				<h3>seeded conversation</h3>
				{info.seed.length === 0 ? (
					<p className="dim small">nothing seeded — the agent starts cold</p>
				) : (
					<div className="turns">
						{info.seed.map((turn) => (
							<div
								className={`turn ${turn.role}`}
								key={`${turn.role}-${turn.content}`}
							>
								<span className={`who ${turn.role}`}>
									{turn.role === "assistant" ? "agent" : "user"}
								</span>
								<pre className="said">{turn.content}</pre>
							</div>
						))}
					</div>
				)}

				<h3>mocked servers</h3>
				{info.mocks.length === 0 ? (
					<p className="dim small">none — nothing is stubbed for this case</p>
				) : (
					<ul className="mocks">
						{info.mocks.map((mock) => (
							<Mock key={mock.name} mock={mock} />
						))}
					</ul>
				)}

				<h3>checks</h3>
				<pre className="said checks-src">{info.checks}</pre>
			</div>
		</details>
	);
}
