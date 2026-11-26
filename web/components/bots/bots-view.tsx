/** What a Bots address shows, on the Bots page or a Board's Bots tab: the gallery, the New Bot form, or one Bot's page. */
import type { Routine } from "../../../src/routines";
import type { Bot } from "../../../src/shared/bots";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import type { BotRow, OpenBot } from "../../bots-model";
import type { Completions } from "../../pane-store";
import type { ModelList } from "../../reads";
import type { BotsRoute } from "../../routing";
import { BotPage, NewBot } from "./bot-page";
import { BotsGallery } from "./bots-gallery";

interface BotsViewProps {
	route: BotsRoute;
	/** The gallery's Bots, `null` while they load. */
	rows: BotRow[] | null;
	routines: Routine[];
	/** The Bot `route` opens, `null` while the Bots load or for a Bot that is gone. */
	open: OpenBot | null;
	bots: readonly Bot[] | null;
	past: PastSession[];
	lastHosts: ReadonlyMap<string, RosterHost>;
	models: ReadonlyMap<string, ModelList>;
	workspaces: Workspace[];
	/** Where the New Bot form starts. */
	defaultCwd: string;
	connected: boolean;
	detailsOpen: boolean;
	onToggleDetails: () => void;
	completions: Completions | null;
}

export function BotsView({ route, rows, routines, open, bots, past, lastHosts, models, workspaces, defaultCwd, connected, detailsOpen, onToggleDetails, completions }: BotsViewProps) {
	if (route.target === null) {
		if (route.adding) return <NewBot workspaces={workspaces} defaultCwd={defaultCwd} connected={connected} />;
		return <BotsGallery rows={rows} routines={routines} />;
	}
	if (!open) return <p className="m-auto text-sm text-muted-foreground">{bots === null ? "Loading the Bots…" : "No Bot has this address. It may have been deleted."}</p>;
	return (
		// Keyed by the Bot, so another Bot's page starts with its own drafts.
		<BotPage
			key={open.bot.id}
			open={open}
			bots={bots ?? []}
			detailsOpen={detailsOpen}
			onToggleDetails={onToggleDetails}
			past={past}
			lastHosts={lastHosts}
			models={models}
			workspaces={workspaces}
			connected={connected}
			completions={completions}
		/>
	);
}
