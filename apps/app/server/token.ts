import { webEnv } from "@repo/env/web";
import { createRemoteJWKSet, errors, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(
	new URL("/api/auth/convex/jwks", webEnv.CONVEX_SITE_URL),
);

export type Verdict =
	| { signed: true; subject: string | undefined }
	| { signed: false; forged: boolean };

const FORGED: readonly (abstract new (...args: never[]) => Error)[] = [
	errors.JWKSNoMatchingKey,
	errors.JWSSignatureVerificationFailed,
	errors.JWSInvalid,
	errors.JWTInvalid,
];

const FOREIGN_CLAIMS: readonly string[] = ["iss", "aud"];

function isForged(error: unknown): boolean {
	if (error instanceof errors.JWTClaimValidationFailed)
		return FOREIGN_CLAIMS.includes(error.claim);
	return FORGED.some((kind) => error instanceof kind);
}

export async function verifyToken(token: string): Promise<Verdict> {
	try {
		const { payload } = await jwtVerify(token, jwks, {
			issuer: webEnv.CONVEX_SITE_URL,
			audience: "convex",
		});
		return {
			signed: true,
			subject: typeof payload.sub === "string" ? payload.sub : undefined,
		};
	} catch (error) {
		return {
			signed: false,
			forged: isForged(error),
		};
	}
}
