/** A leading bold label such as `**Résumé**` or `**Summary:**`, which every reply of a format repeats. */
const LEAD_LABEL = /^\s*\*\*[^*\n]{1,24}\*\*\s*[:.—–-]?\s*/;

/** Markdown read as the words it renders, on one line, so `**Résumé** Done.` reads as `Done.` */
export const plainMarkdown = (text: string): string =>
	text
		.replace(LEAD_LABEL, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
		.replace(/\*\*|__|`/g, "")
		.replace(/\s+/g, " ")
		.trim();
