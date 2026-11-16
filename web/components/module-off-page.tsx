import { moduleOf, type ModulePage } from "../modules";
import { hashForSettings } from "../routing";
import { PageFrame } from "./list-page";
import { LINK } from "./settings/editor";

/** A module's page while the user turned it off in Settings › Modules: what is off, and a link back to its switch. */
export function ModuleOffPage({ page }: { page: ModulePage }) {
	const { tab: { label }, about } = moduleOf(page);
	return (
		<PageFrame title={label} meta={about}>
			<div className="mx-auto w-full max-w-3xl space-y-1 px-6 py-6 text-sm">
				<p>{label} is turned off</p>
				<p className="text-muted-foreground">
					<a href={hashForSettings(page.kind)} className={LINK}>
						Turn it on in Settings › Modules
					</a>
				</p>
			</div>
		</PageFrame>
	);
}
