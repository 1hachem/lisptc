import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { evalsEnv } from "@repo/env/evals";
import { type R2Config, r2Config } from "@repo/env/r2";
import { REPORT_DIR } from "./shards.ts";

export interface StoredReport {
	name: string;
	modifiedAt: number;
}

export interface ReportStore {
	describe(): string;
	list(): Promise<StoredReport[]>;
	read(name: string): Promise<string>;
	write(name: string, body: string): Promise<void>;
}

export function localStore(dir: string): ReportStore {
	return {
		describe: () => `${dir}/`,
		list: async () => {
			let names: string[];
			try {
				names = readdirSync(dir).filter((name) => name.endsWith(".json"));
			} catch {
				return [];
			}
			return names.map((name) => ({
				name,
				modifiedAt: statSync(join(dir, name)).mtimeMs,
			}));
		},
		read: async (name) => readFileSync(join(dir, name), "utf8"),
		write: async (name, body) => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, name), body);
		},
	};
}

export function r2Store(config: R2Config): ReportStore {
	const s3 = new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
	const key = (name: string) => `${config.prefix}${name}`;

	return {
		describe: () => `r2://${config.bucket}/${config.prefix}`,
		list: async () => {
			const found: StoredReport[] = [];
			let cursor: string | undefined;
			do {
				const page = await s3.send(
					new ListObjectsV2Command({
						Bucket: config.bucket,
						Prefix: config.prefix,
						ContinuationToken: cursor,
					}),
				);
				for (const object of page.Contents ?? []) {
					if (object.Key === undefined || !object.Key.endsWith(".json"))
						continue;
					found.push({
						name: object.Key.slice(config.prefix.length),
						modifiedAt: object.LastModified?.getTime() ?? 0,
					});
				}
				cursor = page.NextContinuationToken;
			} while (cursor !== undefined);
			return found;
		},
		read: async (name) => {
			const object = await s3.send(
				new GetObjectCommand({ Bucket: config.bucket, Key: key(name) }),
			);
			if (object.Body === undefined) throw new Error(`${name} has no body`);
			return await object.Body.transformToString();
		},
		write: async (name, body) => {
			await s3.send(
				new PutObjectCommand({
					Bucket: config.bucket,
					Key: key(name),
					Body: body,
					ContentType: "application/json",
				}),
			);
		},
	};
}

export function reportStore(): ReportStore {
	if (evalsEnv.EVAL_STORAGE === "local") return localStore(REPORT_DIR);
	const config = r2Config();
	if (config) return r2Store(config);
	if (evalsEnv.EVAL_STORAGE === "r2")
		throw new Error(
			"EVAL_STORAGE=r2 but no R2 credentials are set. They come from Infisical at /assets, or set EVAL_STORAGE=local to write to the filesystem.",
		);
	return localStore(REPORT_DIR);
}
