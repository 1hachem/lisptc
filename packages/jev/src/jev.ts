import type {
	Questions,
	SystemOneRequest,
	SystemOneResult,
} from "@typesafe-ai/sdk";

export type Ask = <const Q extends Questions>(
	request: SystemOneRequest<Q>,
) => Promise<SystemOneResult<Q>>;

export interface JevHost {
	ask: Ask;
}
