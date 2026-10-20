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
	errors.JWTClaimValidationFailed,
	errors.JWTExpired,
];

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
			forged: FORGED.some((kind) => error instanceof kind),
		};
	}
}
