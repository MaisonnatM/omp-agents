/** The words of the Session card's section headers. */

/** `1 File`, `7 Files`: a section's header count. */
export const countLabel = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
