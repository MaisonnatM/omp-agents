/** A value a dynamic import makes, so its library is a chunk of its own that loads the first time the page needs it. */
import { useEffect, useState } from "react";

export interface LoadedOnce<T> {
	/** The value once it has loaded, else `null`. */
	readonly value: T | null;
	/** Starts the load the first time, and resolves once the value is there. */
	load(): Promise<T>;
}

/** `make` runs once, on the first `load`; should it reject, as a chunk that fails to load does, the value is `fallback`, what the page shows without it. */
export function loadedOnce<T>(make: () => Promise<T>, fallback: T): LoadedOnce<T> {
	let loading: Promise<T> | null = null;
	const loaded: { value: T | null; load(): Promise<T> } = {
		value: null,
		load: () =>
			(loading ??= make()
				.catch(() => fallback)
				.then(value => {
					loaded.value = value;
					return value;
				})),
	};
	return loaded;
}

/** `loaded`'s value, or `null` until it lands, starting its load when `wanted`; the component renders again once it lands. */
export function useLoaded<T>(loaded: LoadedOnce<T>, wanted = true): T | null {
	const [value, setValue] = useState(loaded.value);
	useEffect(() => {
		if (wanted && value === null) void loaded.load().then(next => setValue(() => next));
	}, [loaded, wanted, value]);
	return value ?? loaded.value;
}
