import type { ModelOption, ModelRole } from "../src/shared";
import { useRead } from "./reads";

/**
 * The model omp starts on without `--model` in `cwd`: the one its `default` role names, from a provider you are
 * connected to. `null` until the server answers, and when no `default` role names such a model.
 */
export function useDefaultModel(cwd: string): ModelOption | null {
	const read = useRead<{ roles: ModelRole[] }>(`/api/models/roles?cwd=${encodeURIComponent(cwd)}`);
	return read.data?.roles.find(role => role.role === "default")?.model ?? null;
}
