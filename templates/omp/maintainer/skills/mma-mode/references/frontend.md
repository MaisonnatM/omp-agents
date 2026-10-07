# Frontend

Read this when writing or keeping Vitest cases under `front/__tests__/`, or on any UI / UX creation or meaningful UX change.

## Frontend tests

Hard rules. Follow **behavior-tests**. CI also enforces `__tests__/meta/frontend-test-quality.test.ts`.

- **Outcomes only.** Assert returned values, DOM the user can observe, or `toHaveBeenCalledWith` payloads that are the public contract. Ban `toHaveBeenCalled` / `toHaveBeenCalledTimes` / `not.toHaveBeenCalled` as the sole check.
- **No host-platform retests.** Do not test that a button click fires `onClick`, that refs forward, that Enter activates a native control, or that `onChange` runs on type. Those are React/DOM.
- **No per-route import matrices.** Do not `describe.each` over `getRouteModules()` / page module lists with one `it` per file that only checks `typeof` / `toBeDefined`. One aggregated `expect(violations).toEqual([])` is enough. `tsc` covers types.
- **No permutation spam.** One case per distinct rule. Prefer `it.each` / a loop inside one `it` over N near-duplicate titles (`handles single node`, `handles non-sequential IDs`, …).
- **No sole weak asserts.** Ban `toBeDefined` / `toBeTruthy` / `typeof x === 'string'` as the only expect in an `it`. Assert the literal value or user-visible result.
- **Prefer pure input → output** for utils and models. Prefer RTL user events for product UI. Prefer Playwright for full journeys, not more mock wiring.

## UI / UX

- **Method first:** on UX creation or meaningful UX change, read and follow **linear-method-ux** before sketches or implementation (problem verify, enabler/blocker, scope-down, explore, product-level UX). Source: [Linear Method](https://linear.app/method).
- **Specs:** `@path:line` refs plus ASCII layout sketches when the user gives UI direction. Pasted DOM snippets (`<button class=…>`) are the repro spec.
- **Reuse:** existing empty states, skeletons, command-select patterns, design-system primitives before new components.
- **Iteration:** expect tight follow-ups ("nice, just…"). Ghost buttons, no hover on non-clickable rows, consistent control sizing.
- **Product bar:** Linear/Cursor-style density for power-user surfaces (keyboard shortcuts on buttons, arrow nav, scroll-into-view). Ask for UX recommendation before a large plan when the user asks for it.
- **React changes:** **react-doctor** skill after non-trivial UI edits when finishing the task.
- **Console proof:** **verify-yampa** is the control skill for Yampa UI (maps poteto control-ui / control-cli triggers here).
- **Polish stack:** after Method scope is right, use `better-ui` / `better-layout` / **better-typography** / **better-colors** / **better-accessibility** for craft details.
