export const PLATFORM =
	"An AI agent works for the user by writing lisptc, a Lisp, into a REPL. Each step the agent writes forms; `assistant` turns hold its code, `tool` turns hold what came back: a value, printed output, or an error such as `undefined: name`. Prose around forms is ignored. `system` turns are events from the platform. A memory is a note that loads into the agent's context when its situation arises, so it can act right on its next step.";

export const AREA_QUESTION =
	"Does `latest`, the user's current message and the agent's last step, touch the area of work in `area`, so that a memory filed under it may help the agent's next step? `earlier` is context only: an area touched only there is over.";

export const AREA_SHOWS =
	"`latest` touches the area: the user asks for that kind of work, the agent is doing it or about to, or a result or error of it just came back";

export const AREA_LACKS =
	"nothing in `latest` touches the area; it appears only in `earlier`, or not at all";

export const AREA_OPENS_AT = 0.4;

export const PICK_QUESTION =
	"Which memory, if any, does `latest`, the user's current message and the agent's last step, call for, so it helps the agent's next step? Each option is a memory: the situation it is for, the look-alike it is not for, and what it teaches. `earlier` is context only: a situation that held only there is over. Pick none when no memory's situation holds in `latest`.";

export const NONE_OPTION = "none";

export const NONE_MEANS = "no memory's situation holds in `latest`";

export function optionFor(memory: {
	readonly situation: string;
	readonly unless?: string;
	readonly gist: string;
}): string {
	const unless =
		memory.unless === undefined ? "" : ` Not for: ${memory.unless}.`;
	return `For: ${memory.situation}.${unless} Teaches: ${memory.gist}`;
}
