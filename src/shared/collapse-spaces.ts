/** `text` on one line: every run of whitespace, line breaks included, as one space, and none at either end. */
export const collapseSpaces = (text: string): string => text.replace(/\s+/g, " ").trim();
