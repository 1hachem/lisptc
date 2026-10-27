export type UiValue =
	| string
	| number
	| boolean
	| null
	| UiValue[]
	| { [key: string]: UiValue };

export interface UiNode {
	tag: string;
	props: Record<string, UiValue>;
	children: UiNode[];
}
