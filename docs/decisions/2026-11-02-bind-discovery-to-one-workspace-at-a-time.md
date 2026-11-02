---
status: accepted
date: 2026-11-02
decision-makers: agent
---

# Bind discovery to one workspace at a time

In the context of workspace-specific package previews, facing omp discovery providers that consult a process-wide settings binding, we chose a serialized read-only binding shared by discovery callers over independent overlapping bindings and over a subprocess per preview, to keep provider and disabled-item settings attached to the requested workspace, accepting that slow discovery holds other dashboard discovery reads.

## Context

The settings picker can preview a workspace different from the dashboard process's directory.
Native discovery offers initialization and release, but the newest live binding determines what its providers read.
Other settings, prompt, MCP, and project-trust readers use those same providers.

## Options considered

- One serialized binding uses the native provider semantics and releases settings even on failure.
- Overlapping bindings avoid a queue, but one workspace's settings can affect another workspace's awaited provider read.
- Subprocesses isolate bindings, but add startup overhead and another transport for every discovery request.

## Consequences

The native settings remain read-only during previews.
Authored Files discovery alone can use isolated defaults after a config error so a broken config remains repairable.
Extensions and project-code inspection retain config failures instead of pretending the workspace is empty.
The binding is not a live session reload or runtime inventory.

## Confirmation

`src/extensions.test.ts` exercises project-only discovery and package/workflow ownership through native local packages.
The existing discovery, settings, prompts, MCP, and project-trust tests exercise callers through this common boundary.

## Revisit when

Revisit when omp discovery accepts a settings instance per read without a process-wide binding.
