import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { dashiCodesEnv } from "@repo/env/dashi-codes";
import { type R2Config, r2Config } from "@repo/env/r2";

export interface StoredDocument {
	name: string;
	modifiedAt: number;
}

export interface DocumentStore {
	describe(): string;
	list(): Promise<StoredDocument[]>;
	read(name: string): Promise<string>;
	write(name: string, body: string): Promise<void>;
	remove(name: string): Promise<void>;
}

export function fileStore(dir: string): DocumentStore {
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
		remove: async (name) => {
			rmSync(join(dir, name), { force: true });
		},
	};
}

export function bucketStore(config: R2Config): DocumentStore {
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
			const found: StoredDocument[] = [];
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
		remove: async (name) => {
			await s3.send(
				new DeleteObjectCommand({ Bucket: config.bucket, Key: key(name) }),
			);
		},
	};
}

function mountedDir(): string {
	return resolve(
		process.cwd(),
		dashiCodesEnv.DASHI_CODES_DIR ?? "../../.r2/fallow",
	);
}

function prefixed(config: R2Config): R2Config {
	const trimmed = dashiCodesEnv.DASHI_CODES_PREFIX.replace(/^\/+|\/+$/g, "");
	return { ...config, prefix: trimmed === "" ? "" : `${trimmed}/` };
}

export function documentStore(): DocumentStore {
	if (dashiCodesEnv.DASHI_CODES_STORAGE === "local")
		return fileStore(mountedDir());
	const config = r2Config();
	if (config) return bucketStore(prefixed(config));
	if (dashiCodesEnv.DASHI_CODES_STORAGE === "r2")
		throw new Error(
			"DASHI_CODES_STORAGE=r2 but no R2 credentials are set. They come from Infisical at /assets, or set DASHI_CODES_STORAGE=local to read the mounted bucket from the filesystem.",
		);
	return fileStore(mountedDir());
}
