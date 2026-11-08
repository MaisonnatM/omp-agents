/**
 * The reports the starter kit's `google-accounts` extension leaves for the server, one JSON file each in a directory:
 * Gmail or Google Calendar account `server`, its server's name in omp's MCP config, answered a session's tool call with
 * HTTP 401 at `at`, epoch ms, so it is signed out. The server keeps the report and the bell asks the user to sign in again.
 * A report carries `v`, the version of its shape, now 1; a report of any other version is set aside.
 */
import { isObject } from "../json";
import { type InboxEntry, type InboxOptions, JsonInboxDir } from "./json-inbox";

/** Account `account` found signed out at `at`. */
export interface SignedOutReport {
	account: string;
	at: number;
}

export interface SignInInboxEnv {
	/** Keeps report `report` and tells the bell; reports of accounts that are not Gmail's or Google Calendar's are dropped. */
	report(report: SignedOutReport): Promise<void>;
}

/** The shape of report this server reads. */
export const SIGN_IN_REPORT_VERSION = 1;

/** The report file `name` holds, which must be of {@link SIGN_IN_REPORT_VERSION}. */
export function parseSignInFile(_name: string, value: unknown): InboxEntry<SignedOutReport> {
	if (!isObject(value)) return { invalid: "it is not a sign-out report" };
	if (value.v !== SIGN_IN_REPORT_VERSION) return { invalid: `it is a sign-out report of version ${JSON.stringify(value.v)}, not ${SIGN_IN_REPORT_VERSION}` };
	if (typeof value.server !== "string" || !value.server || typeof value.at !== "number" || !Number.isFinite(value.at)) return { invalid: "it is not a sign-out report" };
	return { item: { account: value.server, at: value.at } };
}

export class SignInInbox extends JsonInboxDir<SignedOutReport> {
	constructor(dir: string, env: SignInInboxEnv, options: InboxOptions = {}) {
		super(
			dir,
			{
				parse: parseSignInFile,
				apply: async report => {
					await env.report(report);
					return true;
				},
			},
			options,
		);
	}
}
