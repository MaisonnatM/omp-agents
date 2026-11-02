/**
 * Dictation through omp's speech-to-text: whether it is on in a directory and where its speech goes, and one capture from
 * this computer's microphone through the bridge omp's RPC mode dictates with.
 */
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { DictationEvent, DictationProcessing, DictationSettings } from "../shared/dictation";
import type { OmpSettingsInstance } from "./module-types/config";
import type { ModelRegistryModule } from "./module-types/models";
import { auth, config, modelRegistry, modelResolver, modelRoles, rpcDictation, sttController, sttModels, sttSettings } from "./modules";

const ROLE = "dictation";

interface Snapshot {
	settings: OmpSettingsInstance;
	registry: InstanceType<ModelRegistryModule["ModelRegistry"]>;
	/** Closes the credential store, which a cloud model's transcription reads until the capture ends. */
	close(): void;
}

/** The settings of `cwd` and the models you can call, read once so the disclosure and the capture agree. */
async function snapshot(cwd: string): Promise<Snapshot> {
	const settings = await config.Settings.loadReadOnly({ cwd });
	const storage = await auth.discoverAuthStorage();
	try {
		const registry = new modelRegistry.ModelRegistry(storage);
		await registry.refresh();
		return { settings, registry, close: () => storage.close() };
	} catch (error) {
		storage.close();
		throw error;
	}
}

/** Where omp's controller sends speech: the first model of the `dictation` role, as it resolves it, else its default local model. */
function processingOf({ settings, registry }: Snapshot): DictationProcessing {
	const pool = modelRoles.roleCandidatePool(ROLE, settings, registry);
	const model = modelResolver.resolveRoleChain(ROLE, settings, pool)[0]?.model;
	if (model?.api === "openai-transcriptions") return { kind: "cloud", model: `${model.provider}/${model.id}` };
	if (model && model.api !== "local-inference") return { kind: "unsupported", api: model.api };
	const spec = sttModels.resolveSttModelSpec(model?.id);
	return { kind: "local", model: spec.label, size: spec.sizeHint };
}

/** Whether dictation is on in `cwd`, which layer decides it, its language, and where its speech goes; opens no microphone. */
export async function dictationSettings(cwd: string): Promise<DictationSettings> {
	const read = await snapshot(cwd);
	try {
		return {
			enabled: sttSettings.cfgSttEnabled.get(read.settings),
			enabledBy: sttSettings.cfgSttEnabled.provenance(read.settings),
			language: sttSettings.cfgSttLanguage.get(read.settings),
			processing: processingOf(read),
		};
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
 * Opens this computer's microphone for capture `captureId` with the settings of `cwd`, refusing when dictation is off there.
 * `emit` gets where speech goes, the microphone's state, the text so far, then always one `end`. The text is never sent anywhere but `emit`.
 */
export function startDictation(cwd: string, captureId: string, emit: (event: DictationEvent) => void): DictationCapture {
	let bridge: InstanceType<typeof rpcDictation.RpcDictationBridge> | null = null;
	let cancelled = false;
	let ended = false;
	const end = (text: string, error: string | null): void => {
		if (ended) return;
		ended = true;
		emit({ kind: "end", text, error });
	};
	void (async () => {
		let read: Snapshot;
		try {
			const dir = await directoryOf(cwd);
			if (dir === null) return end("", `${cwd} is not a directory`);
			read = await snapshot(dir);
		} catch (error) {
			return end("", errorText(error));
		}
		try {
			if (cancelled || !sttSettings.cfgSttEnabled.get(read.settings)) {
				read.close();
				return end("", cancelled ? null : "Dictation is off");
			}
			emit({ kind: "processing", processing: processingOf(read) });
			bridge = new rpcDictation.RpcDictationBridge(
				null,
				frame => {
					if (frame.type === "dictation_state") emit({ kind: "state", state: frame.state });
					else if (frame.type === "dictation_transcript") emit({ kind: "preview", text: frame.text });
					else {
						read.close();
						end(frame.text, frame.error ?? null);
					}
				},
				() => new sttController.STTController({ settings: read.settings, registry: read.registry }),
			);
			// A failed or stopped start has already sent its `dictation_end` frame.
			bridge.start(captureId).catch(() => {});
		} catch (error) {
			read.close();
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
