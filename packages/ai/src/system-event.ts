export interface SystemEvent {
	source: string;
	text: string;
}

const TAG_OPENING = /<(?=\s*\/?\s*system-event)/gi;

export function neutraliseSystemEvents(text: string): string {
	return text.replace(TAG_OPENING, "&lt;");
}

function attribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;");
}

export function renderSystemEvent({ source, text }: SystemEvent): string {
	return `<system-event source="${attribute(source)}">${neutraliseSystemEvents(text)}</system-event>`;
}
