# Reviews and pull request descriptions

## Thermonuclear review

When the user invokes `thermo-nuclear-code-quality-review`, asks for a thermonuclear review, or requests a deep code quality audit, spawn `task` with `agent: "thermonuclear-reviewer"`; it is read-only, so it runs without `isolated` in the session's checkout.
Its `model: "@plan"` frontmatter follows `modelRoles.plan` and that role's fallback chain on any provider.
Pass the review scope and user arguments, then relay the findings verbatim.
Run the skill through this agent, not in the session model.
Apply the findings, commit and push, then add its checkbox as [Review checkboxes](#review-checkboxes) says.

## When a pull request needs the review

A pull request needs the thermonuclear review when its repository commits no `.omp/review-paths`, or when any file it changes matches a glob listed there.
The file lists one glob per line, matched against repository-relative paths; `#` starts a comment and blank lines are ignored.
When the file exists and the pull request touches none of its globs, skip the review and the Thermonuclear stage, and say so in one line of the report.
The ship extension reads the file from the checkout and the changed files from GitHub, and asks for the checkbox only when the review applies; it asks for it whenever GitHub lists fewer files than the pull request changes.

## Interface review

A pull request needs the interface review only when its repository commits `.omp/ui-paths` and a file it changes matches a glob listed there; a repository without the file never needs it.
`.omp/ui-paths` has the same format as `.omp/review-paths`, and the ship extension also asks for the checkbox whenever GitHub lists fewer files than the pull request changes.
A linked worktree missing one of these files reads its main checkout's, so a repository you do not want to carry your setup can keep them uncommitted in the main checkout, listed in `.git/info/exclude`.
The `/ship` Interface review stage runs before the Thermonuclear one, so the code quality review sees the interface fixes.
Spawn `task` with `agent: "interface-reviewer"` and `pr <N>` as the assignment; it is read-only and runs the user's `interface-review` skill in full mode, which hands off to `better-interface` and the `better-*` skills.
It then checks the change against the app's own design system, which it reads from the repository: the shared component library, design tokens, component variants, icon library, written conventions, and sibling screens.
It flags a raw element where a shared component exists, a component that duplicates one, a shared component used against its siblings' pattern, hard-coded values where a token exists, and layout, state, or copy that departs from sibling screens, each citing the component, token, or sibling it should match.
It also lists, under **New patterns**, each kind of UI the change presents in a new way where the app has one established way, such as a list shown as cards in an app whose lists are all tables, even when the PR justifies it.
When a read fails, the agent names the missing skill and stops without reviewing.
Apply the findings in a fresh agent, commit and push, then add its checkbox as [Review checkboxes](#review-checkboxes) says.

## Stalled review and fix agents

A reviewer or fixer agent that has run 20 minutes without a finished result gets one look: read `agent://<id>` for its progress, or `history://<id>` for its transcript, never the newest file under `~/.omp/agent/sessions/`, which is your own session.
When that look shows no edit and no new tool call in the last 10 minutes, stop it with a `write` to `proc://<id>/kill` rather than waiting longer; a provider error can leave it hung for hours.
Then start one fresh agent with the same assignment, or do the work yourself when it is small, and say in the report that the first agent stalled.
Once fixes land, from any agent or your own, check each finding against the diff and name any finding left unapplied; a fix that went to another checkout counts as unapplied.

## Review checkboxes

A review earns its PR checkbox however it ran: in `/ship`, through its reviewer agent, or with its skill invoked directly.
When the reviewed change has a PR, add the checkbox once the review's fixes are committed and pushed: `- [x] Thermo-nuclear code quality review` for the thermonuclear review, `- [x] Interface review` for the interface review.
A review that was only run, not applied, does not earn the checkbox.
Read the current description with `pr_description({repo:"<owner>/<repo>", pr:<N>, change:{kind:"read"}})`, then update it with the same tool's `append` or `replace-text` change without overwriting other content.
If the checkbox already exists, leave it unchanged.
Append it under an existing checklist; otherwise add a `## Checks` section before any `<!-- CURSOR_SUMMARY -->` Bugbot block, or at the end when there is no such block.

## Proof boxes

A repository's PR template can declare `- [ ] Browser proof`.
The ship extension blocks `gh pr ready` while the PR body has that box unchecked and the interface review applies, that is, the repository commits `.omp/ui-paths` and a changed file matches it.
It checks the box, not a screenshot: do what the box and the repository's instructions ask, such as attaching a screenshot as [PR screenshots](#pr-screenshots) describes, then change it to `- [x] Browser proof`.
When the interface review does not apply, the box does not block, and you may delete the line.
Edit the box with `pr_description`'s `replace-text` change, using the exact unchecked line as `oldText` and its checked line as `newText`, keeping the rest of the description.

## PR description layout

Use bullets or an aligned `text` code block for comparisons, rather than markdown pipe tables.
GitHub renders a PR description's table with `display: block; width: max-content`, so it shrink-wraps narrower than surrounding prose and code blocks.
For before-and-after evidence, use the `pr` skill's bullet shape: `**Before:** ... **After:** ...`.

## PR screenshots

Attach screenshots and videos with `gh pr edit <N> --attach './shot.png#Alt text'` alone (`gh` v2.99.0 or later); `gh pr create --draft` and `gh pr comment` take the same flag.
It uploads to `github.com/user-attachments/assets/…`, which keeps the repository's visibility, and appends the image to the body.
Never pass `--body`, `--body-file`, `-b`, or `-F` to `gh pr edit`: the pr-description guard refuses every such command. To place or caption the appended image, read the body with `pr_description` and move its `user-attachments` URL with a `replace-text` change.
When the cwd is not the PR's repository, pass `-R owner/repo`, or `gh` looks for the PR in the cwd's repository.
Never commit images to an assets branch or link Linear upload URLs, which expire after five minutes.
For a sized or side-by-side layout, attach first, then use `pr_description` to put the appended `user-attachments` URLs into `<img>` tags and remove the appended lines.
