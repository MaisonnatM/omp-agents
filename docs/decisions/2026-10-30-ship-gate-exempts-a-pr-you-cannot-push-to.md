---
status: accepted
date: 2026-10-30
decision-makers: agent
---

# The ship gate exempts a PR on a repository you cannot push to

In the context of the ship extension's publish gate, facing an exemption that compared the PR's owner with the owner of the session's checkout, so a yampa-ai PR readied from an omp-agents session skipped every review, we chose to skip the gate only when GitHub reports that the user cannot push to the PR's repository, over comparing the owner with the gh login and over a list of managed owners.
One REST read decides it, a contribution to someone else's project still goes live without the kit's reviews, and every repository of the user and their organizations stays gated.
We accept a false exemption for a PR on a repository where the user holds only a Read or Triage role, and a false gate on a project that gave the user write access but follows its own process.

## Options considered

- Compare the PR's owner with the owner of the session's checkout: the old rule, which exempts the user's own work in another repository.
- Compare the PR's owner with the gh login: right for personal repositories, but it exempts every organization the user works in.
- Keep a list of managed owners: exact, but every user must configure it, and a missing entry silently exempts.
- Ask GitHub for push permission: chosen.
  A failed read gates, so an outage never exempts.

## Consequences

A read-only member of an organization can ready their own PR there without the gate, as an outside contributor can; the organization's reviewers still decide whether it merges.
An outside collaborator with write access to another project meets the gate there, and can check the review box in the PR body to pass it.

## Confirmation

The `-R` table in the `ship publication gate` tests of `templates/omp/extensions.test.ts` exempts a PR without push permission and gates one with push permission or a failed read.

## Revisit when

Revisit when a user works for an organization that grants them Read or Triage only, or when the kit gains a setting that names the repositories `/ship` governs.
