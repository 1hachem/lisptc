export interface ToJson {
	toJSON(): unknown;
}

export interface ForeignValue {
	readonly tag: string;
	readonly data: unknown;
}
