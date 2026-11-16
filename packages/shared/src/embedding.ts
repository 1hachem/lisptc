export interface EmbedRequest {
	inputs: string[];
	model?: string;
}

export interface EmbedResult {
	vectors: number[][];
	model: string;
}

export interface EmbeddingModel {
	readonly provider: string;
	readonly model: string;
	embed(req: EmbedRequest, signal?: AbortSignal): Promise<EmbedResult>;
}
