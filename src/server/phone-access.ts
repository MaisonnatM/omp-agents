/** Phone access: the paired phones, their token hashes, and the one-time pairing codes. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isObject } from "../json";
import { phoneAccessFile } from "../paths";
import { JsonFile } from "../fs";
import { mediaKey } from "./auth";

/** How long a pairing code works. */
export const PAIRING_TTL_MS = 5 * 60_000;
/** Wrong codes tried from one host before the exchange stops answering it for a while. */
const ATTEMPT_CAP = 8;
const ATTEMPT_WINDOW_MS = 5 * 60_000;

/** One paired phone, as the file keeps it: the token's sha256 and its media key's, never the token. */
export interface PairedPhone {
	id: string;
	name: string;
	tokenHash: string;
	/** The sha256 of `mediaKey(token)`, which a tag sends as `?key=` and which cannot be recomputed from `tokenHash`. */
	mediaKeyHash: string;
	pairedAt: string;
	lastSeenAt: string | null;
}

/** Phone access as the file keeps it. */
export interface PhoneAccessState {
	enabled: boolean;
	/** The tailnet DNS name it serves, without a trailing dot, kept from when it was turned on. */
	dnsName: string | null;
	phones: PairedPhone[];
}

const EMPTY: PhoneAccessState = { enabled: false, dnsName: null, phones: [] };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("base64url");

/** Whether `given` hashes to `hash`, in constant time. */
function hashMatches(hash: string, given: string): boolean {
	const digest = Buffer.from(sha256(given));
	const expected = Buffer.from(hash);
	return digest.length === expected.length && timingSafeEqual(digest, expected);
}

function parsePhone(json: unknown): PairedPhone | null {
	if (!isObject(json)) return null;
	const { id, name, tokenHash, mediaKeyHash, pairedAt, lastSeenAt } = json;
	if (typeof id !== "string" || typeof name !== "string" || typeof tokenHash !== "string" || typeof mediaKeyHash !== "string" || typeof pairedAt !== "string") return null;
	if (lastSeenAt !== null && typeof lastSeenAt !== "string") return null;
	return { id, name, tokenHash, mediaKeyHash, pairedAt, lastSeenAt };
}

function parseState(json: unknown): PhoneAccessState | null {
	if (!isObject(json) || typeof json.enabled !== "boolean" || !Array.isArray(json.phones)) return null;
	if (json.dnsName !== null && typeof json.dnsName !== "string") return null;
	const phones = json.phones.map(parsePhone);
	if (phones.some(phone => phone === null)) return null;
	return { enabled: json.enabled, dnsName: json.dnsName, phones: phones as PairedPhone[] };
}

interface PairingCode {
	hash: string;
	expiresAt: number;
	used: boolean;
}

/** The phones and the pairing codes, over the file beside the token. */
export class PhoneAccess {
	readonly #file: JsonFile<PhoneAccessState>;
	#state: PhoneAccessState = EMPTY;
	readonly #codes = new Map<string, PairingCode>();
	readonly #attempts = new Map<string, number[]>();
	/** Closes the sockets a removed phone still holds open. */
	readonly #revoke = new Set<(phoneId: string) => void>();

	constructor(file = phoneAccessFile) {
		this.#file = new JsonFile(file, { parse: parseState, holds: "phone access", onInvalid: "ignore", mode: 0o600 });
		this.#state = this.#file.load() ?? EMPTY;
	}

	/** Phone access as the tab shows it: no token hash leaves the server. */
	view(): { enabled: boolean; dnsName: string | null; phones: { id: string; name: string; pairedAt: string; lastSeenAt: string | null }[] } {
		return {
			enabled: this.#state.enabled,
			dnsName: this.#state.dnsName,
			phones: this.#state.phones.map(({ id, name, pairedAt, lastSeenAt }) => ({ id, name, pairedAt, lastSeenAt })),
		};
	}

	enabled(): boolean {
		return this.#state.enabled;
	}

	/** The tailnet host the guards accept while Phone access is on, else `null`. */
	tailnetHost(): string | null {
		return this.#state.enabled && this.#state.dnsName ? this.#state.dnsName : null;
	}

	/** Turns Phone access on for `dnsName`, or off, which also closes every phone's open sockets. */
	setEnabled(enabled: boolean, dnsName: string | null): void {
		this.#state = { ...this.#state, enabled, dnsName: enabled ? dnsName : this.#state.dnsName };
		this.#file.save(this.#state);
		if (!enabled) for (const phone of this.#state.phones) for (const revoke of this.#revoke) revoke(phone.id);
	}

	/** Remembers the tailnet name Tailscale reports now, which a rename of the Mac changes. */
	refreshDns(dnsName: string | null): void {
		if (!dnsName || dnsName === this.#state.dnsName) return;
		this.#state = { ...this.#state, dnsName };
		this.#file.save(this.#state);
	}

	/** A pairing code that works once, for {@link PAIRING_TTL_MS}, and the moment it stops working. */
	createCode(now = Date.now()): { code: string; expiresAt: number } {
		for (const [code, entry] of this.#codes) if (entry.used || entry.expiresAt <= now) this.#codes.delete(code);
		const code = randomBytes(32).toString("base64url");
		const expiresAt = now + PAIRING_TTL_MS;
		this.#codes.set(code, { hash: sha256(code), expiresAt, used: false });
		return { code, expiresAt };
	}

	/**
	 * Exchanges `code` for a phone's own token, once. A wrong, used, or expired code, or one more try than
	 * {@link ATTEMPT_CAP} from `host` in the window, answers `null` and tells nothing apart.
	 */
	exchange(code: string, name: string, host: string, now = Date.now()): { token: string; mediaKey: string; phone: PairedPhone } | null {
		const attempts = (this.#attempts.get(host) ?? []).filter(at => now - at < ATTEMPT_WINDOW_MS);
		if (attempts.length >= ATTEMPT_CAP) return null;
		const found = [...this.#codes.values()].find(entry => hashMatches(entry.hash, code));
		if (!found || found.used || found.expiresAt <= now) {
			attempts.push(now);
			this.#attempts.set(host, attempts);
			return null;
		}
		found.used = true;
		const token = randomBytes(32).toString("base64url");
		const key = mediaKey(token);
		const phone: PairedPhone = { id: randomBytes(9).toString("base64url"), name: name.slice(0, 60) || "Phone", tokenHash: sha256(token), mediaKeyHash: sha256(key), pairedAt: new Date(now).toISOString(), lastSeenAt: null };
		this.#state = { ...this.#state, phones: [...this.#state.phones, phone] };
		this.#file.save(this.#state);
		return { token, mediaKey: key, phone };
	}

	/** The phone `token` belongs to while Phone access is on, else `null`. */
	phoneFor(token: string): PairedPhone | null {
		if (!this.#state.enabled) return null;
		return this.#state.phones.find(phone => hashMatches(phone.tokenHash, token)) ?? null;
	}

	/** The phone whose media key `key` is, while Phone access is on. */
	phoneForMediaKey(key: string): PairedPhone | null {
		if (!this.#state.enabled) return null;
		return this.#state.phones.find(phone => hashMatches(phone.mediaKeyHash, key)) ?? null;
	}

	/** Notes that `token`'s phone connected now, at most once a minute. */
	seen(token: string, now = Date.now()): void {
		const phone = this.phoneFor(token);
		if (!phone) return;
		if (phone.lastSeenAt && now - Date.parse(phone.lastSeenAt) < 60_000) return;
		const lastSeenAt = new Date(now).toISOString();
		this.#state = { ...this.#state, phones: this.#state.phones.map(entry => (entry.id === phone.id ? { ...entry, lastSeenAt } : entry)) };
		this.#file.save(this.#state);
	}

	/** Forgets `id`'s phone and closes its open sockets; `false` when no phone has that id. */
	remove(id: string): boolean {
		if (!this.#state.phones.some(phone => phone.id === id)) return false;
		this.#state = { ...this.#state, phones: this.#state.phones.filter(phone => phone.id !== id) };
		this.#file.save(this.#state);
		for (const revoke of this.#revoke) revoke(id);
		return true;
	}

	/** Calls `revoke` when a phone is removed, so its sockets close at once. */
	onRemove(revoke: (phoneId: string) => void): void {
		this.#revoke.add(revoke);
	}
}
