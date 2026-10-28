// The Todo page's sections as `user_todo` resolves them, kept free of omp's types so the server's tests can import it.

export interface Section {
	id: string;
	name: string;
}

/**
 * Where a todo filed under section `name` goes: that section, matched case-insensitively, none when `name` is empty,
 * and none with `missing` naming the sections that exist when the list has no such section.
 */
export function sectionFor(sections: Section[] | undefined, name: string | undefined): { categoryId: string | null; missing?: string } {
	if (!name) return { categoryId: null };
	const section = sections?.find(section => section.name.toLowerCase() === name.toLowerCase());
	if (section) return { categoryId: section.id };
	const names = (sections ?? []).map(section => section.name).join(", ") || "none";
	return { categoryId: null, missing: `No section named ${JSON.stringify(name)}; the sections are: ${names}.` };
}
