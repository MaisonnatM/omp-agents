/**
 * The Google calendars the Calendar page's sidebar unchecked, saved in `calendars.json` as `{ hidden }`: each account's
 * hidden calendar ids by the account's server name. A file from before accounts holds one list of ids, which was the
 * original Google Calendar server's.
 */
import { ReducerFile } from "../fs";
import { isObject, isTexts } from "../json";
import { type AccountId, MCP_SERVICES } from "../shared/accounts";

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
	if (isTexts(hidden)) return new Map([[MCP_SERVICES["google-calendar"].serverName, new Set(hidden)]]);
	if (!isObject(hidden) || !Object.values(hidden).every(isTexts)) return null;
	return new Map(Object.entries(hidden as Record<string, string[]>).map(([account, ids]) => [account, new Set(ids)]));
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
}
