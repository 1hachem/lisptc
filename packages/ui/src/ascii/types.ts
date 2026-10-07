export type Category =
	| "scenes"
	| "shapes"
	| "space"
	| "physics"
	| "nature"
	| "creatures"
	| "objects"
	| "generative"
	| "effects"
	| "ui"
	| "data"
	| "type"
	| "logos"
	| "distros";

export type Options = Record<string, unknown>;

export interface Meta<O extends Options = Options> {
	name: string;
	category: Category;
	note: string;
	cols: number;
	rows: number;
	fps: number;
	options?: O;
	clock?: boolean;
	palette?: readonly string[];
	ground?: string;
	cell?: 1 | 2;
}

export interface Env {
	paper?: boolean;
	color?: Uint8Array;
}

export type Frame = (t: number, env?: Env) => string;

export interface Piece<O extends Options = Options> {
	meta: Meta<O>;
	default(options?: Partial<O>): Frame;
}
