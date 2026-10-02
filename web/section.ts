/** A section of a page that a sidebar link scrolls to: the id of its element, and the folds that hide it. */
export interface SectionTarget {
	id: string;
	/** The fold keys the page unfolds first, outermost first. */
	folds: string[];
}

/** An element id from `parts`. It holds no spaces, since `aria-controls` lists ids separated by spaces. */
export const sectionId = (...parts: string[]): string => parts.join("-").toLowerCase().replaceAll(" ", "-");
