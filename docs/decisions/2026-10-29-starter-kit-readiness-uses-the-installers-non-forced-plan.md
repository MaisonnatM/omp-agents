---
status: accepted
date: 2026-10-29
decision-makers: Maxence Maisonnat
---

# Starter kit readiness uses the installer's non-forced plan

Use one installer-owned read-only plan for both installation and checklist status, covering files, settings, marketplace, and plugins.
Customized `keep` and matching `same` entries are complete; pending additions or updates are not.
Status supplies read-only native registry snapshots, not CLI config initialization that may migrate files.
Installation reuses the existing desktop installer through a guarded no-argument bridge; the page owns its inline result and the menu keeps its dialogs.
Use the resolved omp command, including an explicit package override, and ship `config.yml` with the packaged kit.
See [Get started](../architecture/get-started.md#desktop-installation).
