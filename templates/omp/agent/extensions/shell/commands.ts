/**
 * The commands of a bash line, each as its words: split on `&&`, `||`, `;`, `|`, `&`, parentheses, and newlines outside quotes,
 * with quotes removed and leading `NAME=value` assignments dropped, so `cd x && gh pr ready 4` is two commands and `rg "gh pr ready" f` one `rg`.
 */
export function commands(line: string): string[][] {
	const out: string[][] = [];
	let words: string[] = [];
	let word: string | undefined;
	const endWord = () => {
		if (word !== undefined) words.push(word);
		word = undefined;
	};
	const endCommand = () => {
		endWord();
		if (words.length > 0) out.push(words);
		words = [];
	};
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "'") {
			const end = line.indexOf("'", i + 1);
			const stop = end < 0 ? line.length : end;
			word = (word ?? "") + line.slice(i + 1, stop);
			i = stop;
		} else if (c === '"') {
			word ??= "";
			for (i++; i < line.length && line[i] !== '"'; i++) {
				if (line[i] === "\\" && '"\\$`'.includes(line[i + 1] ?? "")) i++;
				word += line[i];
			}
		} else if (c === "\\") {
			i++;
			if (i < line.length && line[i] !== "\n") word = (word ?? "") + line[i];
		} else if (c === " " || c === "\t") {
			endWord();
		} else if (c === "&" && (line[i - 1] === ">" || line[i - 1] === "<" || line[i + 1] === ">")) {
			// The `&` of a redirection such as `2>&1` or `&>file`.
			word = (word ?? "") + c;
		} else if ("&|;()\n".includes(c)) {
			endCommand();
		} else {
			word = (word ?? "") + c;
		}
	}
	endCommand();
	return out.flatMap(w => {
		const start = w.findIndex(x => !/^[A-Za-z_]\w*=/.test(x));
		return start < 0 ? [] : [w.slice(start)];
	});
}
