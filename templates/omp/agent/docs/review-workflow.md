# Reviews and pull request descriptions

## Thermonuclear review

When the user invokes `thermo-nuclear-code-quality-review`, asks for a thermonuclear review, or requests a deep code quality audit, spawn `task` with `agent: "thermonuclear-reviewer"`; it is read-only, so it runs without `isolated` in the session's checkout.
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

## PR screenshots

Attach screenshots and videos with `gh pr edit <N> --attach './shot.png#Alt text'` (`gh` v2.99.0 or later); `gh pr create --draft` and `gh pr comment` take the same flag.
It uploads to `github.com/user-attachments/assets/…`, which keeps the repository's visibility, and rewrites any `![alt](./shot.png)` in `--body-file` to the uploaded URL; otherwise it appends the image.
Each `![alt](path)` in the body must use the exact path string given to `--attach`: for `--attach './shot.png#Alt text'` write `![Alt text](./shot.png)`, since `shot.png` or an absolute path does not match and the image is appended at the end instead.
When the cwd is not the PR's repository, pass `-R owner/repo`, or `gh` looks for the PR in the cwd's repository.
In a Graphite repository, run `gt submit --draft` first, then `gh pr edit`: `gt submit` leaves an existing PR's description alone unless given `--edit-description`.
Never commit images to an assets branch or link Linear upload URLs, which expire after five minutes.
`--attach` rewrites only markdown `![alt](./shot.png)` references, not HTML `<img src>`: for a sized or side-by-side layout, attach first, then put the appended `user-attachments` URLs into the `<img>` tags and remove the appended lines.
