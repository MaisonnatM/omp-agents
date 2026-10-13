import { describe, expect, test } from "bun:test";
import { MAX_PROMPT_FILE_CHARS } from "../src/shared/prompt-files";
import { type Attachment, type AttachmentRead, preparePrompt } from "./prompt-attachments-model";

const textFile = (name: string, text: string): Attachment => ({
	file: new File([text], name, { type: "text/plain" }),
	read: Promise.resolve({ kind: "file", file: { name, text } }),
});

describe("preparePrompt", () => {
	test("a file still converting when the prompt sends is refused once it reads past the limit, not delivered", async () => {
		const first = textFile("a.txt", "x".repeat(MAX_PROMPT_FILE_CHARS - 10));
		const pending = Promise.withResolvers<AttachmentRead>();
		const late: Attachment = { file: new File(["%PDF-"], "b.pdf", { type: "application/pdf" }), read: pending.promise };
		const prepared = preparePrompt([first, late], "hi", true);
		pending.resolve({ kind: "file", file: { name: "b.pdf", text: "y".repeat(20) } });
		const { prompt, accepted, refused } = await prepared;
		expect(accepted).toEqual([first]);
		expect(prompt).not.toContain('<file name="b.pdf">');
		expect(refused).toEqual([`A prompt carries up to ${MAX_PROMPT_FILE_CHARS.toLocaleString("en-US")} characters of files, so b.pdf stayed out.`]);
	});

	test("keeps files in attach order whichever reads first, and refuses a failed read", async () => {
		const slow = Promise.withResolvers<AttachmentRead>();
		const first: Attachment = { file: new File(["a"], "a.txt"), read: slow.promise };
		const second = textFile("b.txt", "x".repeat(MAX_PROMPT_FILE_CHARS));
		const broken: Attachment = { file: new File(["c"], "c.doc"), read: Promise.reject(new Error("cannot convert")) };
		const prepared = preparePrompt([first, second, broken], "", true);
		slow.resolve({ kind: "file", file: { name: "a.txt", text: "a" } });
		const { prompt, accepted, refused } = await prepared;
		expect(accepted).toEqual([first]);
		expect(prompt).toBe('<file name="a.txt">\na\n</file>');
		expect(refused).toHaveLength(2);
		expect(refused[1]).toStartWith("c.doc stayed out.");
	});

	test("refuses images for a subject that takes text only, before reading them", async () => {
		const image: Attachment = { file: new File(["i"], "i.png", { type: "image/png" }), read: Promise.resolve({ kind: "image", image: { data: "aQ==", mimeType: "image/png" } }) };
		const { images, accepted, refused } = await preparePrompt([image], "hi", false);
		expect(images).toEqual([]);
		expect(accepted).toEqual([]);
		expect(refused).toEqual(["A subagent takes text only, so i.png stayed out."]);
	});
});
