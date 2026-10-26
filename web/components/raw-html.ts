/** The rehype plugins that render GitHub and Linear text's raw HTML, a chunk of their own that `MessageMarkdown` loads for the first such text. */
import type { Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/** GitHub's schema, plus the `<video>` a Linear issue's recording or a GitHub upload becomes, with its `<source>`. */
const SANITIZE_SCHEMA = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "video", "source"],
	attributes: { ...defaultSchema.attributes, video: ["src"], source: ["src"] },
};

/** Raw HTML parsed into the tree, then sanitized to what GitHub allows. */
export const RAW_HTML: NonNullable<Options["rehypePlugins"]> = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]];
