import { isObject } from "../json";
import { runJson } from "../proc";
import type { CatalogModel } from "../shared";
import { ompCommand } from "./install";

const MODELS_TIMEOUT_MS = 30_000;

/** Every model `omp models` lists for this agent dir, in omp's order. */
export async function listModels(): Promise<CatalogModel[]> {
	const data = await runJson([...ompCommand, "models", "--json"], { timeoutMs: MODELS_TIMEOUT_MS });
	if (!isObject(data) || !Array.isArray(data.models)) throw new Error("omp models --json printed no models");
	return (data.models as unknown[]).flatMap((model): CatalogModel[] =>
		isObject(model) && typeof model.selector === "string" && typeof model.provider === "string"
			? [
					{
						selector: model.selector,
						provider: model.provider,
						name: typeof model.name === "string" ? model.name : model.selector,
						thinking: Array.isArray(model.thinking) ? model.thinking.filter(level => typeof level === "string") : [],
					},
				]
			: [],
	);
}
