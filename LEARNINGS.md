# Learnings

Pitfalls agents have hit in this repository, with the fix.
Add one when a mistake cost a retry and the docs did not prevent it.

## New worktree

- Run `bun install --frozen-lockfile` in the worktree before `tsc`, which otherwise fails with `Cannot find type definition file for 'bun'`.
- Install rather than symlink the main checkout's `node_modules`: when the worktree already has a `node_modules` directory, `ln -s` creates a stray `node_modules/node_modules` link inside it, and `rm node_modules` then fails.
