/** The sidebar foot's memory row: pressure, memory in use, and swap, which opens Settings › Resources. */
import { IconChip } from "central-icons";
import { formatBytes } from "../labels";
import { PRESSURE_LABEL, PRESSURE_TONE, resourcesStore } from "../resources";
import { hashForSettings } from "../routing";
import { GaugeCell, GaugeTile } from "./gauge-tile";

export function MemoryCard() {
	const reading = resourcesStore.usePolling().read?.data.reading ?? null;
	const known = reading !== null && reading.pressure !== "unknown" && reading.totalBytes > 0;
	const used = known ? 1 - reading.availableBytes / reading.totalBytes : null;
	const pressure = reading?.pressure ?? "unknown";
	const swap = known ? `, swap ${formatBytes(reading.swapUsedBytes)}` : "";
	return (
		<GaugeCell>
			<GaugeTile
				as="button"
				label={`Memory: ${PRESSURE_LABEL[pressure]} pressure${used === null ? "" : `, ${Math.round(used * 100)}% in use`}${swap}. Opens Resources.`}
				fill={used}
				tone={PRESSURE_TONE[pressure]}
				icon={<IconChip className="size-3.5" />}
				caption={pressure === "normal" ? `Memory${swap}` : `Memory ${PRESSURE_LABEL[pressure].toLowerCase()}${swap}`}
				value={used === null ? null : `${Math.round(used * 100)}%`}
				onClick={() => {
					location.hash = hashForSettings("resources");
				}}
			/>
		</GaugeCell>
	);
}
