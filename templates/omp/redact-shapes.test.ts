import { describe, expect, test } from "bun:test";
import { placeholder, Redactor } from "./agent/extensions/redact-secrets/redact";

const redact = (text: string) => new Redactor().redact(text, false);

describe("shaped secrets in any text, a tool result included", () => {
	const keys: [string, string][] = [
		[`ghp_${"a1B2".repeat(9)}`, "github token"],
		[`gho_${"a1B2".repeat(9)}`, "github token"],
		[`github_pat_11ABCDEFG0${"x_Y9".repeat(15)}`, "github token"],
		[`sk-ant-api03-${"aB3_-".repeat(10)}`, "anthropic api key"],
		[`sk-${"aB3x".repeat(12)}`, "openai api key"],
		[`sk-proj-${"aB3_".repeat(12)}`, "openai api key"],
		["xoxb-1234567890-0987654321-AbCdEfGhIjKl", "slack token"],
		["xoxp-1234567890-0987654321-AbCdEfGhIjKl", "slack token"],
		[`lin_api_${"Ab3x".repeat(10)}`, "linear api key"],
		["AKIAIOSFODNN7EXAMPLE", "aws access key id"],
		["-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----", "private key"],
		["-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----", "private key"],
	];
	for (const [key, label] of keys) {
		test(label, () => {
			expect(redact(`output: ${key} done`)).toBe(`output: ${placeholder(label)} done`);
		});
	}

	test("a Bearer header's token, keeping a known key's own label", () => {
		expect(redact("curl -H 'Authorization: Bearer abcDEF123.ghi-JKL_456~mno/pq==' https://x")).toBe(`curl -H 'Authorization: ${"Bearer "}${placeholder("bearer token")}' https://x`);
		expect(redact("authorization: bearer abcdefghijklmnopqrstuvwx")).toBe(`authorization: bearer ${placeholder("bearer token")}`);
		const anthropic = `sk-ant-api03-${"aB3_-".repeat(10)}`;
		expect(redact(`Bearer ${anthropic}`)).toBe(`Bearer ${placeholder("anthropic api key")}`);
	});

	test("leaves Bearer references and prose alone", () => {
		for (const text of [
			'curl -H "Authorization: Bearer $(cat ~/.config/omp-agents/token)"',
			"Authorization: Bearer $TOKEN",
			"Authorization: Bearer ${API_TOKEN}",
			"Bearer tokens expire after an hour.",
			"lin_api_short",
		]) {
			expect(redact(text)).toBe(text);
		}
	});
});
