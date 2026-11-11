export interface EntryMeta {
	description?: string;
	keywords?: string[];
	icon?: string;
}

export interface ResourceAmounts {
	cpu?: string;
	memory?: string;
}

export interface Resources {
	requests?: ResourceAmounts;
	limits?: ResourceAmounts;
}

export interface IssuerOAuth {
	issuer: string;
	authorize: string;
	token: string;
	client: string;
	params?: Record<string, string>;
}

export interface NamedPort {
	name: string;
	port: number;
}

export interface AppContainer {
	image: string;
	args?: string[];
	ports?: NamedPort[];
	expose?: string[];
	resources?: Resources;
}

export interface SecretRef {
	name: string;
	keys: string[];
}

export type RemoteEntry = EntryMeta & {
	name: string;
	url: string;
	headers?: Record<string, string>;
	oauth?: boolean | IssuerOAuth;
	scopes?: string[];
};

export type LaunchedEntry = RemoteEntry & {
	command: string;
	args?: string[];
	env?: Record<string, string>;
};

export type ImageEntry = EntryMeta & {
	name: string;
	image: string;
	internal?: boolean;
	port: number;
	path?: string;
	command?: string;
	args?: string[];
	headers?: Record<string, string>;
	env?: Record<string, string>;
	secret?: SecretRef;
	oauth?: IssuerOAuth;
	scopes?: string[];
	resources?: Resources;
	app?: AppContainer;
	flags?: Record<string, string[]>;
};

export type CommandEntry = EntryMeta & {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
	resources?: Resources;
	flags?: Record<string, string[]>;
};

type EntryKey =
	| keyof RemoteEntry
	| keyof LaunchedEntry
	| keyof ImageEntry
	| keyof CommandEntry;

type Only<T> = T & { [K in Exclude<EntryKey, keyof T>]?: never };

export type ToolkitEntry =
	| Only<RemoteEntry>
	| Only<LaunchedEntry>
	| Only<ImageEntry>
	| Only<CommandEntry>;

export type ProductionEntry = Only<RemoteEntry> | Only<ImageEntry>;

export type MachineEntry = Only<CommandEntry>;
