export interface NoulQuestion {
	readonly type: "noul";
	readonly instructions: string;
	readonly criteria?: { readonly true: string; readonly false: string };
}

export type SystemOneQuestion = NoulQuestion;

export interface SystemOneRequest<K extends string> {
	readonly state: unknown;
	readonly questions: Readonly<Record<K, SystemOneQuestion>>;
	readonly signal?: AbortSignal;
}

export interface SystemOneDecision<K extends string> {
	readonly answers: Readonly<Record<K, { readonly noul: number }>>;
	readonly cost: number;
}

export interface SystemOneProvider {
	decide<K extends string>(
		request: SystemOneRequest<K>,
	): Promise<SystemOneDecision<K>>;
}
