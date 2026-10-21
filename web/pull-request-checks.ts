import type { CheckState, PullRequestCheck } from "../src/shared/github";

export interface ChecksPresentation {
	state: CheckState;
	heading: string;
	text: string;
	attention: PullRequestCheck[];
	running: PullRequestCheck[];
	completed: PullRequestCheck[];
}

export function presentChecks(checks: readonly PullRequestCheck[]): ChecksPresentation {
	const attention: PullRequestCheck[] = [];
	const running: PullRequestCheck[] = [];
	const completed: PullRequestCheck[] = [];
	let passed = 0;
	for (const check of checks) {
		if (check.state === "failing") attention.push(check);
		else if (check.state === "pending") running.push(check);
		else {
			completed.push(check);
			if (check.state === "passing") passed++;
		}
	}
	const state: CheckState = checks.length === 0 ? "none" : attention.length > 0 ? "failing" : running.length > 0 ? "pending" : "passing";
	const heading = state === "none"
		? "No checks reported"
		: state === "failing"
			? "Some checks were not successful"
			: state === "pending"
				? "Some checks haven't completed yet"
				: passed === checks.length ? "All checks have passed" : "Checks completed";
	const text = checks.length === 0
		? "No checks reported"
		: attention.length > 0
			? `${attention.length} of ${checks.length} failing`
			: running.length > 0
				? `${running.length} of ${checks.length} running`
				: passed === checks.length ? "All checks passed" : `${passed} of ${checks.length} passing`;
	return { state, heading, text, attention, running, completed };
}
