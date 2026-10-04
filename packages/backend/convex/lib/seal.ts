const IV_BYTES = 12;

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	const raw = atob(text);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

function toBase64(bytes: Uint8Array): string {
	let raw = "";
	for (const byte of bytes) raw += String.fromCharCode(byte);
	return btoa(raw);
}

async function keyFrom(secret: string): Promise<CryptoKey> {
	const bytes = fromBase64(secret);
	if (bytes.length !== 32)
		throw new Error("the credential key must be 32 bytes, base64-encoded");
	return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

export async function seal(secret: string, plain: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const cipher = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await keyFrom(secret),
		new TextEncoder().encode(plain),
	);
	return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function unseal(secret: string, sealed: string): Promise<string> {
	const [iv, cipher] = sealed.split(".");
	if (iv === undefined || cipher === undefined)
		throw new Error("not a sealed value");
	const plain = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: fromBase64(iv) },
		await keyFrom(secret),
		fromBase64(cipher),
	);
	return new TextDecoder().decode(plain);
}
