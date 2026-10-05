# Reviews and pull request descriptions

## Thermonuclear review

When the user invokes `thermo-nuclear-code-quality-review`, asks for a thermonuclear review, or requests a deep code quality audit, spawn `task` with `agent: "thermonuclear-reviewer"` and `isolated: true` for a Git repository.
Its `model: "@plan"` frontmatter follows `modelRoles.plan` and that role's fallback chain on any provider.
Pass the review scope and user arguments, then relay the findings verbatim.
Run the skill through this agent, not in the session model.

When the review targets a PR, add `- [x] Thermo-nuclear code quality review` only after the review's fixes are committed and pushed.
A review that was only run, not applied, does not earn the checkbox.
Read the current PR description and update it with `gh pr edit <N> --body-file <file>` without overwriting other content.
If the checkbox already exists, leave it unchanged.
Append it under an existing checklist; otherwise add a `## Checks` section before any `<!-- CURSOR_SUMMARY -->` Bugbot block, or at the end when there is no such block.

## PR description layout

Use bullets or an aligned `text` code block for comparisons, rather than markdown pipe tables.
GitHub renders a PR description's table with `display: block; width: max-content`, so it shrink-wraps narrower than surrounding prose and code blocks.
For before-and-after evidence, use the `pr` skill's bullet shape: `**Before:** ... **After:** ...`.
