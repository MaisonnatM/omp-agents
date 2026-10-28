/**
 * The types of bippy's `core` entry, which `preview-pick.ts` reads fibers with. bippy 0.6.1 points `bippy/core` at the
 * types of a shared chunk, which export its functions under the chunk's one- and two-letter names, while the entry's
 * own types, under their real names, ship as `dist/core2.d.ts`.
 */
declare module "bippy/core" {
	export * from "bippy/dist/core2";
}
