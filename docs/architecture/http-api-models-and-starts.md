# HTTP API: models, skills, and session starts

`GET /api/models/connected?cwd=<directory>` answers `{ models }`: the models that `omp models` lists from the providers you are connected to, for the new-session draft's model menu.
Each model is `{ provider, id, name, contextWindow, curated, thinkingLevels }`; `curated` marks the ones that the directory's `modelRoles` or `retry.fallbackChains` name, as omp resolves each selector, and `thinkingLevels` are the ones omp's catalog lists (`modelEntries` in `src/omp/models.ts`).
The models of the providers that `modelProviderOrder` names come first, in that order, and the rest keep omp's order.
A live session's `list-models` answer builds the same entries from the models that its omp RPC process offers and the config of the session's directory.
A `start` of kind `new` carries a `model`, `null` for omp's default; the server sends omp `set_model` once it is ready and before the first prompt, and a model that omp refuses fails the start.

`GET /api/models/roles?cwd=<directory>` answers `{ roles }`, each `{ role, model, thinking }`; the new-session draft reads the `default` role's model from it to name the model omp starts on.
Like `/api/git`, `cwd` may name any directory.
`connectedRoles` in `src/omp/models.ts` loads `modelRoles` with omp's read-only loader for that directory, so a project's `.omp/config.yml` overrides count, and reads each role's selector against `omp models`: a `:level` suffix becomes `thinking`, and `@role` or `*` takes the named role's model and level unless it adds its own.
Roles that name a model by a fuzzy pattern, or one on a provider you are not connected to, are left out.
A `start` of kind `new` and a `set-model` each carry a `thinking`, `null` to keep omp's level; the server sends omp `set_thinking_level` after `set_model`.

A dashboard session's row carries `fast`, `{ enabled, active }` from omp's state, or `null` while its model has no priority tier.
`set-fast` with `enabled` sends omp `set_fast_mode`, and the session then reads omp's state again; omp refuses to enable it for a model without the tier, which shows as a note.

`GET /api/skills?cwd=<directory>` answers `{ skills }`, each `{ name, description }`: the skills that `/skill:<name>` invokes in a session started in that directory, from the same discovery as the composer's `/` completions (`listSkills` in `src/commands.ts`), and none when omp's `skills.enableSkillCommands` is off.
Both leave out a skill whose frontmatter `name` holds whitespace, such as `Poteto Mode`: omp reads a `/skill:` name up to the first space, so no prompt can invoke it.
The settings page lists them to pin one, and the new-session draft reads them to show whether the pinned skill exists there.
The page keeps the pin in localStorage (`web/pinned-skill.ts`).
A `start` of kind `new` carries a `skill`, `null` for none: the draft sends the pin unless you turned it off there, and a quick action always sends it.
Once the server knows the directory omp runs in, worktree included, `withPinnedSkill` puts `/skill:<skill> ` before the first prompt, so omp's RPC prompt invokes the skill with the prompt as its arguments.
A directory without that skill, or a prompt that starts with `/`, keeps the prompt as typed.

A `start` of kind `new` carries a `subject`, `null` for none: a quick action sends the pull request or Linear issue it works on, and one on a todo sends no subject and names the todo in `todoId` instead.
`LiveSessions` keeps it by instance id, and `rows()` puts it first among the session's `pullRequests` or `tickets` until the session's tool calls name it, so the roster links the session to its subject from the start, before omp writes the session file.
The link goes when the session ends.

A `start` of kind `new` carries a `branch`, `null` for the directory as it is.
For an existing branch, the server runs omp in the worktree that has it checked out, or in the starting directory when that worktree is the directory's own (`git rev-parse --show-toplevel`); with no such worktree it runs `git worktree add <dir> <branch>`.
For a new branch, it runs `git check-ref-format --branch` and then `git worktree add -b <branch> <dir> <base>`.
`<dir>` is `worktreeDir` in `src/shared/git.ts`, beside the main worktree.
The server refuses a `<dir>` that already exists, because `git worktree add -b` creates the branch before it checks the path.
A branch that git refuses answers the `start` with git's reason, and no omp spawns.
A failed start makes the draft read the checkout again, so a branch that the start created shows as an existing one.
