/**
 * `useEditableRead`: a server read that writes change in place, and the one owner of what it shows: the server's last
 * answer, from a read or a write, and the edits that show over it until they answer.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { errorText, getJson } from "./api";
import type { ReadState } from "./reads";

/** An edit that shows at once, until the service answers it. */
interface PendingEdit<T> {
	id: number;
	shown: Partial<T>;
}

/**
 * One resource as its owner holds it. `confirmed` is the server's last answer with its revision, how many writes had
 * answered when it was asked: a read takes the count when it is sent, a write the count with itself. An answer older
 * than `confirmed` changes nothing, so a read sent before a write cannot hide that write's answer.
 */
export interface EditableState<T> {
	url: string | null;
	confirmed: { data: T; revision: number } | null;
	/** Why the last read failed, until an answer comes. */
	error: string | null;
	/** The edits sent or waiting their turn, in order, which show over `confirmed`. */
	pending: PendingEdit<T>[];
	/** Why the service refused the last edit, until another edit starts. */
	saveError: string | null;
}

export type EditableEvent<T> = { url: string } & (
	| { kind: "read"; data: T; revision: number }
	| { kind: "unread"; error: string }
	| { kind: "edited"; id: number; shown: Partial<T> }
	| { kind: "saved"; id: number | null; data: T; revision: number }
	| { kind: "refused"; id: number; error: string }
);

export const emptyEditable = <T>(url: string | null): EditableState<T> => ({ url, confirmed: null, error: null, pending: [], saveError: null });

const confirm = <T>(state: EditableState<T>, data: T, revision: number): EditableState<T> =>
	state.confirmed && revision < state.confirmed.revision ? state : { ...state, confirmed: { data, revision }, error: null };

/**
 * `state` after `event`. A read or an edit of another `url` starts that resource afresh; a write's answer for another
 * `url` is dropped, since the resource it changed no longer shows. A refused edit leaves `pending`, which undoes it.
 */
export function reduceEditable<T>(state: EditableState<T>, event: EditableEvent<T>): EditableState<T> {
	if (event.url !== state.url) {
		if (event.kind === "saved" || event.kind === "refused") return state;
		state = emptyEditable(event.url);
	}
	switch (event.kind) {
		case "read":
			return confirm(state, event.data, event.revision);
		case "unread":
			return { ...state, error: event.error };
		case "edited":
			return { ...state, pending: [...state.pending, { id: event.id, shown: event.shown }], saveError: null };
		case "saved":
			return confirm({ ...state, pending: state.pending.filter(edit => edit.id !== event.id) }, event.data, event.revision);
		case "refused":
			return { ...state, pending: state.pending.filter(edit => edit.id !== event.id), saveError: event.error };
	}
}

/** What `state` shows: its confirmed answer with each pending edit over it, in order. */
export const shownOf = <T>(state: EditableState<T>): T | null =>
	state.confirmed && state.pending.reduce((data, edit) => ({ ...data, ...edit.shown }), state.confirmed.data);

export interface Editable<T> extends ReadState<T> {
	/** Why the service refused the last edit; `null` once another edit starts. */
	saveError: string | null;
	/**
	 * Shows `shown` over the answer at once, then calls `send` once every write before it has answered. Its answer
	 * becomes the confirmed one, with the edits still pending over it; a refusal undoes `shown` and names why.
	 */
	edit: (shown: Partial<T>, send: () => Promise<T>) => void;
	/** Calls `send` in turn with the edits, and shows what it answers; the caller handles its refusal. */
	write: (send: () => Promise<T>) => Promise<T>;
	/** Reads again, keeping what shows until the answer arrives. */
	reload: () => void;
}

/**
 * The server's answer at `url`, which `edit` and `write` change. Nothing shows while `url` is `null` or until it first
 * answers for `url`. A change of `version` or a `reload` reads it again, keeping what shows meanwhile and when that read
 * fails. Writes go one at a time, in the order they were made.
 */
export function useEditableRead<T extends object>(url: string | null, version?: unknown): Editable<T> {
	const [state, dispatch] = useReducer(reduceEditable<T>, url, emptyEditable<T>);
	const [reads, setReads] = useState(0);
	const answered = useRef(0);
	const edits = useRef(0);
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	useEffect(() => {
		if (url === null) return;
		const controller = new AbortController();
		const revision = answered.current;
		// An abort makes `getJson` reject, and an answer that arrives with it must not show either.
		getJson<T>(url, controller.signal).then(
			data => {
				if (!controller.signal.aborted) dispatch({ url, kind: "read", data, revision });
			},
			(err: unknown) => {
				if (!controller.signal.aborted) dispatch({ url, kind: "unread", error: errorText(err) });
			},
		);
		return () => controller.abort();
	}, [url, version, reads]);

	const send = (write: () => Promise<T>): Promise<{ data: T; revision: number }> => {
		const sent = queue.current.then(write).then(data => ({ data, revision: ++answered.current }));
		queue.current = sent.catch(() => {});
		return sent;
	};
	const current = state.url === url ? state : null;
	const data = useMemo(() => current && shownOf(current), [current]);
	return {
		data,
		error: current?.error ?? null,
		saveError: current?.saveError ?? null,
		edit: (shown, write) => {
			if (url === null) return;
			const id = ++edits.current;
			dispatch({ url, kind: "edited", id, shown });
			send(write).then(
				answer => dispatch({ url, kind: "saved", id, ...answer }),
				(err: unknown) => dispatch({ url, kind: "refused", id, error: errorText(err) }),
			);
		},
		write: async write => {
			const answer = await send(write);
			if (url !== null) dispatch({ url, kind: "saved", id: null, ...answer });
			return answer.data;
		},
		reload: () => setReads(count => count + 1),
	};
}
