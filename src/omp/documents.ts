import { extname } from "node:path";
import { markit } from "./modules";

/** omp could not convert a document: its format is one omp does not read, or the file is not what its name says. */
export class UnreadableDocument extends Error {}

/** Document `name`'s text as omp's read tool sees it: PDF, Word, PowerPoint, Excel, and EPUB files as Markdown. */
export async function documentText(name: string, bytes: Uint8Array): Promise<string> {
	const converted = await markit.convertBufferWithMarkit(bytes, extname(name));
	if (!converted.ok) throw new UnreadableDocument(`omp could not read it: ${converted.error ?? "conversion failed"}`);
	return converted.content;
}
