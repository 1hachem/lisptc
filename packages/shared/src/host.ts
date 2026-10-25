export type Awaitable<T> = T | Promise<T>;

export type PromptSource = () => string;

export interface Clock {
	now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export interface SourceFolder {
	list(workspace: string, folder: string): Awaitable<string[]>;
	read(
		workspace: string,
		folder: string,
		name: string,
	): Awaitable<string | undefined>;
	write(
		workspace: string,
		folder: string,
		name: string,
		text: string,
	): Awaitable<void>;
	remove(workspace: string, folder: string, name: string): Awaitable<boolean>;
}
