---
name: docs-and-changelog
description: Decide whether a change needs a docs or changelog edit at all. Use before adding or editing docs or a changelog entry for a change.
---

# Docs and changelog

This skill narrows the harness rule that a permanent fix or feature must update docs and changelog.
A change needs a docs or changelog edit only when a reader of that page would act differently because of it; a PR adds none by default.
Cosmetic UI changes, internal refactors, and fixes that restore documented behavior leave docs untouched.
When the repository has its own docs rules, they decide.
