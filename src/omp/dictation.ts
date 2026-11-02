/**
 * Dictation through omp's speech-to-text: whether it is on in a directory and where its speech goes, and one capture from
 * this computer's microphone through the bridge omp's RPC mode dictates with.
 */
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { DictationEvent, DictationProcessing, DictationSettings } from "../shared/dictation";
import { type OpenRegistry, openRegistry } from "./models";
import { modelResolver, modelRoles, rpcDictation, sttController, sttModels, sttSettings } from "./modules";

const ROLE = "dictation";

/** Where omp's controller sends speech: the first model of the `dictation` role, as it resolves it, else its default local model. */
function processingOf({ settings, registry }: OpenRegistry): DictationProcessing {
	const pool = modelRoles.roleCandidatePool(ROLE, settings, registry);
	const model = modelResolver.resolveRoleChain(ROLE, settings, pool)[0]?.model;
	if (model?.api === "openai-transcriptions") return { kind: "cloud", model: `${model.provider}/${model.id}` };
	if (model && model.api !== "local-inference") return { kind: "unsupported", api: model.api };
	const spec = sttModels.resolveSttModelSpec(model?.id);
	return { kind: "local", model: spec.label, size: spec.sizeHint };
}

/** Whether dictation is on, which layer decides it, its language, and where its speech goes, as `read` has them. */
const settingsOf = (read: OpenRegistry): DictationSettings => ({
	enabled: sttSettings.cfgSttEnabled.get(read.settings),
	enabledBy: sttSettings.cfgSttEnabled.provenance(read.settings),
	language: sttSettings.cfgSttLanguage.get(read.settings),
	processing: processingOf(read),
});

/** Whether dictation is on in `cwd`, which layer decides it, its language, and where its speech goes; opens no microphone. */
export async function dictationSettings(cwd: string): Promise<DictationSettings> {
	const read = await openRegistry(cwd);
	try {
		return settingsOf(read);
	} finally {
		read.close();
	}
}

/** One capture under way: `stop` keeps what was said, `dispose` closes the microphone at once. */
export interface DictationCapture {
	stop(): void;
	dispose(): void;
}

/**
 * Opens this computer's microphone for capture `captureId` with the settings of `cwd`. Where dictation is off, `emit` gets
 * the settings and the microphone stays closed; else where speech goes, the microphone's state, and the text so far.
 * Either way the last event is one `end`. The text is never sent anywhere but `emit`.
 */
export function startDictation(cwd: string, captureId: string, emit: (event: DictationEvent) => void): DictationCapture {
	let bridge: InstanceType<typeof rpcDictation.RpcDictationBridge> | null = null;
	let read: OpenRegistry | null = null;
	let cancelled = false;
	let ended = false;
	const end = (text: string, error: string | null): void => {
		if (ended) return;
		ended = true;
		read?.close();
		emit({ kind: "end", text, error });
	};
	void (async () => {
		try {
			const dir = await directoryOf(cwd);
			if (dir === null) return end("", `${cwd} is not a directory`);
			read = await openRegistry(dir);
			if (cancelled) return end("", null);
			const settings = read.settings;
			if (!sttSettings.cfgSttEnabled.get(settings)) {
				emit({ kind: "off", settings: settingsOf(read) });
				return end("", "Dictation is off");
			}
			emit({ kind: "processing", processing: processingOf(read) });
			const registry = read.registry;
			bridge = new rpcDictation.RpcDictationBridge(
				null,
				frame => {
					if (frame.type === "dictation_state") emit({ kind: "state", state: frame.state });
					else if (frame.type === "dictation_transcript") emit({ kind: "preview", text: frame.text });
					else end(frame.text, frame.error ?? null);
				},
				() => new sttController.STTController({ settings, registry }),
			);
			// A failed or stopped start has already sent its `dictation_end` frame.
			bridge.start(captureId).catch(() => {});
		} catch (error) {
			end("", errorText(error));
		}
	})();
	return {
		stop() {
			if (bridge) bridge.stop().catch(() => {});
			else cancelled = true;
		},
		dispose() {
			if (bridge) bridge.dispose();
			else cancelled = true;
		},
	};
}
