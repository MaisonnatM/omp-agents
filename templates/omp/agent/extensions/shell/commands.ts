/**
 * The commands of a bash line, each as its words: split on `&&`, `||`, `;`, `|`, `&`, parentheses, and newlines outside quotes,
 * with quotes removed and leading `NAME=value` assignments and `env` prefixes dropped, so `cd x && gh pr ready 4` is two commands,
 * `env -u GITHUB_TOKEN gt submit` runs `gt submit`, and `rg "gh pr ready" f` is one `rg`.
 */
export function commands(line: string): string[][] {
	return split(line).flatMap(w => {
		const { words } = program(w);
		return words.length > 0 ? [words] : [];
	});
}

/** The program a command's words run, past `NAME=value` assignments and `env` prefixes, and each directory an `env -C` there changes to, in order. */
export function program(w: string[]): { words: string[]; chdir: string[] } {
	const chdir: string[] = [];
	let i = 0;
	for (;;) {
		if (/^[A-Za-z_]\w*=/.test(w[i] ?? "")) {
			i++;
		} else if (w[i] === "env") {
			for (i++; w[i]?.startsWith("-"); i++) {
				const flag = w[i];
				const dir = flag.match(/^(?:--chdir=|-C)(.+)$/)?.[1];
				if (dir !== undefined) chdir.push(dir);
				// `-u`, `-C`, and `-P` take the next word as their operand.
				else if (/^(-[uCP]|--unset|--chdir)$/.test(flag)) {
					i++;
					if (flag === "-C" || flag === "--chdir") chdir.push(w[i] ?? "");
				}
			}
		} else {
			break;
		}
	}
	return { words: w.slice(i), chdir };
}

/** A bash line's commands as their words, split and unquoted as `commands` does, with nothing dropped. */
export function split(line: string): string[][] {
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
	return out;
}
