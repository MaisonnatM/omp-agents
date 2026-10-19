/**
 * The Google calendars the Calendar page's sidebar unchecked, saved in `calendars.json` as `{ hidden }`: each account's
 * hidden calendar ids by the account's server name. A file from before accounts holds one list of ids, which was the
 * first Google Calendar server's, whatever its name; it waits under {@link BEFORE_ACCOUNTS} until
 * {@link CalendarsFile.adopt} names that server.
 */
import { ReducerFile } from "../fs";
import { isObject, isTexts, recordOf } from "../json";
import type { AccountId } from "../shared/accounts";

/** Where a file from before accounts keeps its one list; omp names no server "". */
const BEFORE_ACCOUNTS = "";

/** Each account's hidden calendar ids. */
export type HiddenCalendars = ReadonlyMap<AccountId, ReadonlySet<string>>;

/** `hidden` once calendar `id` of `account` shows or hides, or `hidden` itself when it already does. */
function showCalendar(hidden: HiddenCalendars, account: AccountId, id: string, shown: boolean): HiddenCalendars {
	const ids = hidden.get(account) ?? new Set<string>();
	if (ids.has(id) !== shown) return hidden;
	const nextIds = new Set(ids);
	if (shown) nextIds.delete(id);
	else nextIds.add(id);
	const next = new Map(hidden);
	if (nextIds.size === 0) next.delete(account);
	else next.set(account, nextIds);
	return next;
}

function parseHidden(value: unknown): HiddenCalendars | null {
	if (!isObject(value)) return null;
	const { hidden } = value;
	if (isTexts(hidden)) return new Map([[BEFORE_ACCOUNTS, new Set(hidden)]]);
	if (!recordOf(isTexts)(hidden)) return null;
	return new Map(Object.entries(hidden).map(([account, ids]) => [account, new Set(ids)]));
}

/** The ids of the calendars whose events the Calendar page leaves out, by account. */
export class CalendarsFile extends ReducerFile<HiddenCalendars, [account: AccountId, id: string, shown: boolean]> {
	constructor(path: string) {
		super(path, {
			parse: parseHidden,
			toJson: hidden => ({ hidden: Object.fromEntries([...hidden].map(([account, ids]) => [account, [...ids]])) }),
			holds: "a list of hidden calendars",
			empty: new Map(),
			reduce: showCalendar,
		});
	}

	/** Gives the hidden calendars of a file from before accounts to `account`, the first Google Calendar server; whether there were any. */
	adopt(account: AccountId): boolean {
		return this.update(hidden => {
			const before = hidden.get(BEFORE_ACCOUNTS);
			if (!before) return hidden;
			const next = new Map(hidden);
			next.delete(BEFORE_ACCOUNTS);
			next.set(account, new Set([...(hidden.get(account) ?? []), ...before]));
			return next;
		});
	}
}
