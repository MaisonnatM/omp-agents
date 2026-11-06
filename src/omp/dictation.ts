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

type Bridge = InstanceType<typeof rpcDictation.RpcDictationBridge>;

/**
 * Opens this computer's microphone for capture `captureId` with the settings of `cwd`. Where dictation is off, `emit` gets
 * the settings and the microphone stays closed; else where speech goes, the microphone's state, and the text so far.
 * Either way the last event is one `end`, which never waits on omp's bridge for a stop before the microphone opens, a
 * dispose, or a bridge that fails. The text is never sent anywhere but `emit`.
 */
export function startDictation(cwd: string, captureId: string, emit: (event: DictationEvent) => void): DictationCapture {
	let capture: { phase: "opening" } | { phase: "bridged"; bridge: Bridge; read: OpenRegistry } | { phase: "ended" } = { phase: "opening" };
	const end = (text: string, error: string | null): void => {
		if (capture.phase === "ended") return;
		if (capture.phase === "bridged") capture.read.close();
		capture = { phase: "ended" };
		emit({ kind: "end", text, error });
	};
	/** Read through a call, since a stop or dispose can end the capture while the opening awaits. */
	const ended = (): boolean => capture.phase === "ended";
	void (async () => {
		let read: OpenRegistry | null = null;
		try {
			const dir = await directoryOf(cwd);
			if (ended()) return;
			if (dir === null) return end("", `${cwd} is not a directory`);
			read = await openRegistry(dir);
			if (ended()) return read.close();
			const settings = read.settings;
			if (!sttSettings.cfgSttEnabled.get(settings)) {
				emit({ kind: "off", settings: settingsOf(read) });
				read.close();
				return end("", "Dictation is off");
			}
			emit({ kind: "processing", processing: processingOf(read) });
			const registry = read.registry;
			const bridge = new rpcDictation.RpcDictationBridge(
				null,
				frame => {
					if (capture.phase === "ended") return;
					if (frame.type === "dictation_state") emit({ kind: "state", state: frame.state });
					else if (frame.type === "dictation_transcript") emit({ kind: "preview", text: frame.text });
					else end(frame.text, frame.error ?? null);
				},
				() => new sttController.STTController({ settings, registry }),
			);
			capture = { phase: "bridged", bridge, read };
			// A failed or stopped start has already sent its `dictation_end` frame; one that did not ends here.
			bridge.start(captureId).catch((error: unknown) => end("", errorText(error)));
		} catch (error) {
			if (capture.phase === "opening") read?.close();
			end("", errorText(error));
		}
	})();
	return {
		stop() {
			if (capture.phase === "bridged") capture.bridge.stop().catch((error: unknown) => end("", errorText(error)));
			// Nothing was said before the microphone opened.
			else end("", null);
		},
		dispose() {
			// Whoever disposes drops the text, so the capture ends now, whether or not the bridge sends its own end.
			if (capture.phase === "bridged") capture.bridge.dispose();
			end("", null);
		},
	};
}
