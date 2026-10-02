export type Awaitable<T> = T | Promise<T>;

export type PromptSource = () => string;

export interface Clock {
	now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
