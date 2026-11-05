/**
 * Finds secrets in text and JSON values and swaps each for `[redacted secret: <what it was>]`.
 * Shaped keys (Stripe, GitHub, OpenAI, …) are found anywhere; a password or `NAME_SECRET=` pair only in what the user wrote,
 * and the values those pairs and database URLs give are then replaced wherever else they appear.
 */

/** The text that replaces a secret; it has no quote or backslash, so it stays valid inside any JSON string. */
export function placeholder(label: string): string {
	return `[redacted secret: ${label}]`;
}

const B = "(?<![A-Za-z0-9_-])";
const E = "(?![A-Za-z0-9_-])";

/** A pattern whose group 1 is kept and group 2 is the secret; a `learn` label also replaces the value everywhere else. */
interface Rule {
	re: RegExp;
	label: string | ((match: string[]) => string);
	learn?: boolean;
	/** Minimum length of the secret for the match to count. */
	min?: number;
}

const token = (prefix: string, body: string, label: string): Rule => ({ re: new RegExp(`()${B}(${prefix}${body})${E}`, "g"), label });

/** Secrets whose shape gives them away, found in any text. */
const SHAPED: Rule[] = [
	{ re: /()(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g, label: "private key" },
	token("sk_live_", "[A-Za-z0-9]{10,}", "stripe live secret key"),
	token("sk_test_", "[A-Za-z0-9]{10,}", "stripe test secret key"),
	token("rk_live_", "[A-Za-z0-9]{10,}", "stripe live restricted key"),
	token("rk_test_", "[A-Za-z0-9]{10,}", "stripe test restricted key"),
	token("pk_live_", "[A-Za-z0-9]{10,}", "stripe live publishable key"),
	token("whsec_", "[A-Za-z0-9]{20,}", "stripe webhook secret"),
	token("sk-ant-", "[A-Za-z0-9_-]{20,}", "anthropic api key"),
	token("sk-", "(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}", "openai api key"),
	token("gh[pousr]_", "[A-Za-z0-9]{30,}", "github token"),
	token("github_pat_", "[A-Za-z0-9_]{30,}", "github token"),
	token("glpat-", "[A-Za-z0-9_-]{20,}", "gitlab token"),
	token("xox[abposr]-", "[A-Za-z0-9-]{10,}", "slack token"),
	token("npm_", "[A-Za-z0-9]{36}", "npm token"),
	token("sb_secret_", "[A-Za-z0-9_-]{20,}", "supabase secret key"),
	token("GOCSPX-", "[A-Za-z0-9_-]{20,}", "google client secret"),
	token("AIza", "[A-Za-z0-9_-]{35}", "google api key"),
	token("(?:AKIA|ASIA)", "[A-Z0-9]{16}", "aws access key id"),
	{
		re: /((?:aws_secret_access_key|aws_secret_key|secret_access_key|secretaccesskey)["']?\s*[:=]\s*["']?)([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/gi,
		label: "aws secret access key",
	},
	token("eyJ", "[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}", "jwt token"),
	{
		re: /((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|cockroachdb)(?:\+[a-z0-9]+)?:\/\/[^\s:/@'"<>]*:)([^\s@'"<>]+)(?=@)/gi,
		label: "database password",
		learn: true,
	},
];

/** A quoted value, or a bare one up to the next space, so a password holding `;` or `,` is taken whole. */
const QUOTED_OR_BARE = `("[^"\\n]*"|'[^'\\n]*'|[^\\s"'\`]+)`;

/** Pairs that name a secret, found only in what the user wrote. */
const USER_PAIRS: Rule[] = [
	{
		re: new RegExp(`((?:["'])?(?<![A-Za-z0-9_])(?:password|passwd|passphrase|mot de passe|mdp)(?:["'])?\\s*[:=]\\s*)${QUOTED_OR_BARE}`, "gi"),
		label: "password",
		learn: true,
	},
	{
		re: new RegExp(`((?<![A-Za-z0-9_])[A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*["']?\\s*[:=]\\s*)${QUOTED_OR_BARE}`, "g"),
		label: match => match[1]!.replace(/["'\s:=]/g, ""),
		learn: true,
		min: 8,
	},
];

/** A 40-character run with both cases, on the same line as an AWS access key id, is that key's secret; a hex git hash has one case only. */
const AWS_LINE = /(?:AKIA|ASIA)[A-Z0-9]{16}|\[redacted secret: aws access key id\]/;
const AWS_SECRET = /(?<![A-Za-z0-9/+])(?=[A-Za-z0-9/+]*[a-z])(?=[A-Za-z0-9/+]*[A-Z])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/g;

/** Values that point at a secret rather than hold one, and a secret already replaced. */
function isReference(value: string): boolean {
	return (
		value.length === 0 ||
		/^(?:\[redacted|\$|<|\{\{|%|process\.env|os\.environ|env\(|getenv)/i.test(value) ||
		/^[*x•.]+$/i.test(value)
	);
}

/** Literal values shorter than this are replaced only where a pair or URL names them, never everywhere. */
const MIN_LITERAL = 8;

/** Redacts text with what it has learned so far; one per session, so a value learned in one turn is still caught in the next. */
export class Redactor {
	readonly #literals = new Map<string, string>();
	/** {@link #literals} longest first, so a value that contains another is replaced whole. */
	#ordered: [string, string][] = [];
	#version = 0;

	/** Grows each time a new literal value is learned, so callers know to look again at text they found clean. */
	get version(): number {
		return this.#version;
	}

	/** Remembers the values `text` names, without changing it; `user` text also yields password pairs. */
	learn(text: string, user: boolean): void {
		const before = this.#literals.size;
		for (const rule of user ? [...USER_PAIRS, ...SHAPED] : SHAPED) {
			if (!rule.learn) continue;
			for (const match of text.matchAll(rule.re)) {
				const value = unquote(match[2]!);
				const label = labelOf(rule, match);
				let decoded = value;
				try {
					decoded = decodeURIComponent(value);
				} catch {}
				// A bare value at the end of a sentence carries its full stop; the value used elsewhere does not.
				for (const candidate of [value, decoded, value.replace(/[.,;:!?)\]]+$/, "")]) {
					if (candidate.length >= Math.max(rule.min ?? 0, MIN_LITERAL) && !isReference(candidate)) this.#literals.set(candidate, label);
				}
			}
		}
		if (this.#literals.size === before) return;
		this.#ordered = [...this.#literals].sort((a, b) => b[0].length - a[0].length);
		this.#version++;
	}

	/** `text` with every secret it holds replaced; the same string when it holds none. */
	redact(text: string, user: boolean): string {
		let out = text;
		for (const rule of SHAPED) out = apply(out, rule);
		// After the shaped keys, so `STRIPE_SECRET_KEY=sk_live_…` names the key's kind and the pair sees a placeholder.
		if (user) for (const rule of USER_PAIRS) out = apply(out, rule);
		if (AWS_LINE.test(out)) out = out.split("\n").map(line => (AWS_LINE.test(line) ? line.replace(AWS_SECRET, placeholder("aws secret access key")) : line)).join("\n");
		for (const [value, label] of this.#ordered) if (out.includes(value)) out = out.split(value).join(placeholder(label));
		return out === text ? text : out;
	}
}

function unquote(value: string): string {
	return /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value;
}

function labelOf(rule: Rule, match: string[]): string {
	return typeof rule.label === "string" ? rule.label : rule.label(match);
}

function apply(text: string, rule: Rule): string {
	rule.re.lastIndex = 0;
	if (!rule.re.test(text)) return text;
	return text.replace(rule.re, (...args: unknown[]) => {
		const match = args.slice(0, 3) as string[];
		const [whole, kept, secret] = match as [string, string, string];
		const value = unquote(secret);
		if (isReference(value) || value.length < (rule.min ?? 1)) return whole;
		const quote = value === secret ? "" : secret[0]!;
		return `${kept}${quote}${placeholder(labelOf(rule, match))}${quote}`;
	});
}

/** Fields that hold provider signatures or encrypted state, which must stay byte-for-byte as the provider sent them. */
const OPAQUE_KEYS: Record<string, true> = { thinkingSignature: true, textSignature: true, signature: true, encrypted_content: true, encryptedContent: true };

/**
 * `value` with every string redacted, sharing every part that did not change; the same reference when nothing did.
 * A thinking block whose text changed loses its signature, so a resumed session replays it as plain text instead of
 * sending the provider a signature that no longer matches.
 */
export function redactValue<T>(value: T, redact: (text: string) => string): T {
	if (typeof value === "string") return redact(value) as T;
	if (Array.isArray(value)) {
		let changed = false;
		const items = value.map(item => {
			const next = redactValue(item, redact);
			if (next !== item) changed = true;
			return next;
		});
		return (changed ? items : value) as T;
	}
	if (value === null || typeof value !== "object") return value;
	const object = value as Record<string, unknown>;
	if (object.type === "image" || object.type === "redactedThinking") return value;
	let out: Record<string, unknown> | undefined;
	for (const [key, field] of Object.entries(object)) {
		if (Object.hasOwn(OPAQUE_KEYS, key)) continue;
		const next = redactValue(field, redact);
		if (next === field) continue;
		out ??= { ...object };
		out[key] = next;
	}
	if (!out) return value;
	if (object.type === "thinking" && out.thinking !== object.thinking) delete out.thinkingSignature;
	return out as T;
}

/** Calls `visit` on every string inside `value`, skipping the same opaque fields {@link redactValue} keeps. */
export function eachString(value: unknown, visit: (text: string) => void): void {
	if (typeof value === "string") return visit(value);
	if (Array.isArray(value)) {
		for (const item of value) eachString(item, visit);
		return;
	}
	if (value === null || typeof value !== "object") return;
	const object = value as Record<string, unknown>;
	if (object.type === "image" || object.type === "redactedThinking") return;
	for (const [key, field] of Object.entries(object)) if (!Object.hasOwn(OPAQUE_KEYS, key)) eachString(field, visit);
}
