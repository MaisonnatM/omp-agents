---
name: omp-release
description: Check a new omp release against omp-agents before the tested version moves to it. Use when omp ships a release, a routine runs the omp release check, or someone asks whether this repository works with an omp version.
---

# omp release check

omp-agents imports omp's own modules from the installed package (see [omp modules](../../../docs/architecture.md#omp-modules)), so each omp release can break it, change behavior it relies on, or add something the dashboard should handle.
This check finds which, with evidence, and moves the version pins only when nothing else needs to change.

An unattended run (a routine started the session, or the prompt says unattended) makes every call itself and ends with the report; it never asks a question.

## 1. Run the script

Run `bun run omp-release` from the repository root, or `bun run omp-release <version>` for a release other than npm's latest.
When it prints `omp <version> is the newest release; nothing to check`, report that line and stop.
Otherwise it prints the report's path and a three-line summary; a failing test is a finding, not a reason to stop.

## 2. Read the report

The report has five sections: Tests, Module check, omp files, Changelogs, and Source diffs.
Read Tests, Module check, and omp files in full, then the Changelogs and Source diffs section by section, by line range.
The tested version is the one `.github/workflows/checks.yml` installs; the release checked is the target.
The script deletes its installs, so an omp line comes from a diff's `+` side, whose line numbers are the target's.
For a file without a diff, run `bun add --linker hoisted @oh-my-pi/pi-coding-agent@<target>` in an empty temporary directory and read it under `node_modules/@oh-my-pi/`.

## 3. Check the patch

`patches/*.patch` is written against a checkout of upstream omp, not the npm package.
For each patch, clone the target's tag and check it there:

```sh
git clone --depth 1 --branch v<target> https://github.com/can1357/oh-my-pi <tmp>/omp
git -C <tmp>/omp apply --check <repo>/patches/<patch>
git -C <tmp>/omp apply --check --exclude='packages/*/CHANGELOG.md' <repo>/patches/<patch>
```

The second check leaves out the changelog hunks, which fail on most releases, so the files it names are the source that needs porting.
Remove the clone afterwards.

## 4. Sort every finding

Go through every changelog section and every changed file in the report.
For each, find what in this repository it touches: the bullet of [omp modules](../../../docs/architecture.md#omp-modules) that names the file, the `src/omp/` file that loads it, and the callers of the export, found with grep.
Each finding goes in one bucket:

- **MUST change**: a failing test or module check, an export or behavior this repository relies on that the release changed (RPC frames and commands, the session file format, settings keys, paths), a patch whose source hunks no longer apply, and the version pins, which every newer release needs.
  The pins are `.github/workflows/checks.yml`, `.github/workflows/release.yml`, the README's omp badge and its `Tested with omp` line, and the `placeholder` in `.github/ISSUE_TEMPLATE/bug_report.yml`.
- **SHOULD adopt**: a new capability the dashboard should handle as an RPC host or a session viewer, such as a new RPC command, frame, or field, a new session entry type, or a new extension UI request.
- **Docs drift**: a statement in `docs/architecture.md`, `docs/usage.md`, or `docs/code-layout.md` that the release makes false, such as a moved file, a renamed export, or changed behavior that a doc describes.

Every finding carries four pieces of evidence: the changelog version, the quoted changelog entry (or `no changelog entry` for one found only in a diff), the repository `file:line` it affects, and the omp `file:line` that shows it.
A changed file with no finding goes on a No impact line with a one-sentence reason.
The step is done when every changed file in the report sits in a bucket or on the No impact list, and every changelog section has been read.

## 5. Report, and bump the pins when that is all

Write the report as Markdown: the versions, the test and module check results, the patch result, the three buckets, and the No impact list.

When MUST change holds only the version pins, and both the tests and the module check passed, open the version bump:

1. Create a worktree off `origin/main` on a branch named `omp-<target>`, outside this checkout, and run `bun install --frozen-lockfile` there.
2. In it, change the tested version to the target at every pin site listed under MUST change.
3. Run `bun test` and `bun run typecheck` there.
4. Commit with the message `Test with omp <target>`, and save your report to a file outside the worktree.
   The report is the PR body; the script's file is not, since it holds every diff and outgrows GitHub's 65,536-character limit.
5. Open a draft PR from the worktree.
   When `test -f "$(git rev-parse --path-format=absolute --git-common-dir)/.graphite_repo_config"` succeeds, run `gt track omp-<target> -p main --no-interactive`, `gt submit --draft --no-edit --no-ai --no-interactive`, and `gh pr edit omp-<target> --body-file <report>`.
   Otherwise run `git push -u origin omp-<target>` and `gh pr create --draft --base main --title "Test with omp <target>" --body-file <report>`.

In every other case, deliver the report and leave the repository as it is.
