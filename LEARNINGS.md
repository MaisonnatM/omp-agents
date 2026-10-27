# Learnings

Pitfalls agents have hit in this repository, with the fix.
Add one when a mistake cost a retry and the docs did not prevent it.

## GitHub rate limit

- `gh`, `gt`, and the dashboard share your token's GraphQL budget of 5000 points an hour; once `GraphQL: API rate limit already exceeded`, or the kit's `GitHub GraphQL quota exhausted; next request after <time>`, shows, every `gh pr` command and `gt submit` fails until the reset, so retrying them sooner only fails again.
- Run `gh api rate_limit --jq '.resources.graphql | {remaining, reset: (.reset | todate)}'` for the reset time; it costs no points, and the `reset` it prints is UTC.
- REST has its own budget, so `gh api -X POST repos/<owner>/<repo>/pulls -f head=<branch> -f base=main -f title=<title> -f body=<body> -F draft=true` opens a draft, and `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f body=<body>` edits its title, body, or base meanwhile.
- Marking a pull request ready or back to draft has no REST endpoint: wait for the reset, or report the exact `gh pr ready <n>` left to run.
