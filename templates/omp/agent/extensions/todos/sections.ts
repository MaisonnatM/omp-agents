// The Todo page's sections as `user_todo` resolves them, kept free of omp's types so the server's tests can import it.

export interface Section {
	id: string;
	name: string;
}

/** The section named `name`, matched case-insensitively, or the error naming the ones that exist. */
export function sectionNamed(sections: Section[] | undefined, name: string): { id: string } | { error: string } {
	const section = sections?.find(section => section.name.toLowerCase() === name.toLowerCase());
	if (section) return section;
	const names = (sections ?? []).map(section => section.name).join(", ") || "none";
	return { error: `No section named ${JSON.stringify(name)}; the sections are: ${names}.` };
}

/**
 * Where an add naming section `name` files its todo: that section, else none, with the note that says so.
 * An agent cannot create a section, so refusing the add would only have it retry the same name.
 */
export function addSection(sections: Section[] | undefined, name: string | undefined): { categoryId: string | null; note: string } {
	if (!name) return { categoryId: null, note: "" };
	const section = sectionNamed(sections, name);
	return "id" in section ? { categoryId: section.id, note: "" } : { categoryId: null, note: ` It is in no section. ${section.error}` };
}
