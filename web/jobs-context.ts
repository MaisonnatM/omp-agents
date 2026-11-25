/** Each live session's background jobs by instance id, which the Overview tab's Jobs section and the sidebar's session rows read. */
import { createContext } from "react";
import type { BackgroundJob } from "../src/shared/jobs";

export const JobsContext = createContext<Readonly<Record<string, readonly BackgroundJob[]>>>({});
