/**
 * The rows of a TSV or CSV file. A TSV row is a line and its cells split at tabs. A CSV cell follows RFC 4180: one in
 * double quotes may hold commas, line breaks, and `""` for a quote.
 */
export function parseDelimited(text: string, separator: "\t" | ","): string[][] {
	const body = text.replace(/\r?\n$/, "");
	if (body === "") return [];
	if (separator === "\t") return body.split(/\r?\n/).map(line => line.split("\t"));
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let at = 0; at < body.length; at++) {
		const char = body[at];
		if (quoted) {
			if (char !== '"') cell += char;
			else if (body[at + 1] === '"') {
				cell += '"';
				at++;
			} else quoted = false;
		} else if (char === '"' && cell === "") quoted = true;
		else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else if (char !== "\r" || body[at + 1] !== "\n") cell += char;
	}
	row.push(cell);
	rows.push(row);
	return rows;
}
