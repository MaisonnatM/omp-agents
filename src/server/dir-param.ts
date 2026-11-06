import { directoryOf } from "../paths";
import { fail } from "./http";

/** The directory `?cwd=` names, or the response refusing it. Like a new session, `cwd` may name any directory. */
export async function dirParam(params: URLSearchParams): Promise<string | Response> {
	return (await directoryOf(params.get("cwd") ?? "")) ?? fail(404, "Expected ?cwd= naming a directory");
}
