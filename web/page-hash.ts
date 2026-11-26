/** How the links of a project or pull request page name the pages they open: their own addresses, or a Board Workspace tab's. */
import { createContext, useContext } from "react";
import { hashForPage, type PageHash } from "./routing";

/** A Board's Workspace tab provides its own, so a project or pull request opened there stays in the tab. */
export const PageHashContext = createContext<PageHash>(hashForPage);

export const usePageHash = (): PageHash => useContext(PageHashContext);
