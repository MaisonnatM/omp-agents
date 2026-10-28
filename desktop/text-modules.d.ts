/** A file `bun build` inlines as its text, as `preview-preload.ts` imports the bundled `preview-grab.ts`. */
declare module "*.txt" {
	const text: string;
	export default text;
}
