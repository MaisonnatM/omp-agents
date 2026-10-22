import { useRef, useState } from "react";
import { isComparisonId, type ComparisonSpec } from "../src/shared/comparisons";
import { errorText } from "./api";

type Launch = { kind: "ready" } | { kind: "pending"; id: string } | { kind: "uncertain"; id: string; error: string } | { kind: "failed"; error: string };
const STORAGE_KEY = "omp-agents.pending-comparison";

export function useComparisonStart(onStart: (id: string, spec: ComparisonSpec) => Promise<void>) {
	const [launch, setLaunch] = useState<Launch>(() => {
		const id = sessionStorage.getItem(STORAGE_KEY);
		return isComparisonId(id) ? { kind: "uncertain", id, error: "A previous comparison start has not been acknowledged in this browser." } : { kind: "ready" };
	});
	const claimed = useRef("id" in launch ? launch.id : null);
	const start = async (spec: ComparisonSpec): Promise<void> => {
		if (claimed.current !== null) return;
		const id = crypto.randomUUID();
		claimed.current = id;
		try {
			sessionStorage.setItem(STORAGE_KEY, id);
		} catch (error) {
			claimed.current = null;
			setLaunch({ kind: "failed", error: `Could not save the comparison identity. Nothing was sent. ${errorText(error)}` });
			return;
		}
		setLaunch({ kind: "pending", id });
		try {
			await onStart(id, spec);
			sessionStorage.removeItem(STORAGE_KEY);
			setLaunch({ kind: "ready" });
		} catch (error) {
			setLaunch({ kind: "uncertain", id, error: errorText(error) });
		}
	};
	const reset = (): void => {
		if (launch.kind === "pending") return;
		sessionStorage.removeItem(STORAGE_KEY);
		claimed.current = null;
		setLaunch({ kind: "ready" });
	};
	return { launch, start, reset };
}
