import type { ModelOption, ModelRole } from "../src/shared";
import { useCwdRead } from "./use-cwd-read";

/**
 * The model omp starts on without `--model` in `cwd`: the one its `default` role names, from a provider you are
 * connected to. `null` until the server answers, and when no `default` role names such a model.
 */
export function useDefaultModel(cwd: string): ModelOption | null {
	const read = useCwdRead<{ roles: ModelRole[] }>("/api/models/roles", cwd);
	return (read?.ok && read.value.roles.find(role => role.role === "default")?.model) || null;
}
