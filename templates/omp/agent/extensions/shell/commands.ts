import { isAbsolute, resolve } from "node:path";

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

/** Commands that run the command after their own flags and `NAME=value` settings; `program` reads `env`, whose `-C` changes directory. */
const WRAPPERS: Record<string, true> = { builtin: true, command: true, exec: true, nice: true, nohup: true, sudo: true, time: true };
const SHELLS: Record<string, true> = { bash: true, sh: true, zsh: true };

/** A command of a bash line with the directory it runs in, `null` when a variable, a command substitution, or `cd -` names it. */
export interface Located {
	words: string[];
	dir: string | null;
}

/** The commands of a bash line run from `cwd`, past wrappers such as `nohup`, each with its directory, following `cd`, `pushd`, `popd`, `env -C`, and into `bash -c` scripts. */
export function located(line: string, cwd: string | null): Located[] {
	const out: Located[] = [];
	let dir = cwd;
	for (let words of split(line)) {
		// The directory this command alone runs in, after any `env -C`.
		let here = dir;
		for (;;) {
			const run = program(words);
			for (const to of run.chdir) here = within(here, to);
			words = run.words;
			if (words[0] === undefined || !Object.hasOwn(WRAPPERS, words[0])) break;
			let k = 1;
			while (k < words.length && (words[k].startsWith("-") || /^[A-Za-z_]\w*=/.test(words[k]))) k++;
			words = words.slice(k);
		}
		const [tool, ...rest] = words;
		if (tool === undefined) continue;
		if (tool === "cd" || tool === "pushd") {
			const [to] = positionals(rest);
			dir = to === "-" || (tool === "pushd" && to === undefined) ? null : within(dir, to);
		} else if (tool === "popd") {
			dir = null;
		} else if (Object.hasOwn(SHELLS, tool)) {
			const flag = rest.findIndex(a => /^-\w*c\w*$/.test(a));
			if (flag !== -1 && rest[flag + 1] !== undefined) out.push(...located(rest[flag + 1], here));
		}
		out.push({ words, dir: here });
	}
	return out;
}

/** A command's positional words: not flags, and not redirections such as `>/dev/null`, `2>&1`, or a bare `>` and its target. */
export function positionals(args: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const redirect = args[i].match(/^(?:\d*|&)(?:>>|>&|<&|>|<)(.*)$/);
		if (redirect) {
			if (!redirect[1]) i++;
		} else if (args[i] === "-" || !args[i].startsWith("-")) {
			out.push(args[i]);
		}
	}
	return out;
}

/** `path`, which defaults to home, resolved from `dir` with `~` and `$HOME` expanded; `null` when another variable, a command substitution, or an unknown `dir` decides it. */
export function within(dir: string | null, path: string | undefined): string | null {
	const home = process.env.HOME ?? "";
	const expanded = (path ?? home).replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
	if (/[$`]/.test(expanded)) return null;
	if (isAbsolute(expanded)) return expanded;
	return dir === null ? null : resolve(dir, expanded);
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
