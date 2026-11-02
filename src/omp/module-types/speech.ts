/** omp's speech-to-text (src/stt, src/modes/rpc/rpc-dictation.ts): its settings, its models, and the capture behind RPC dictation. */
import type { DictationSource } from "../../shared/dictation";
import type { OmpSettingsInstance, SettingsReader } from "./config";
import type { ModelRegistryModule, OmpModel } from "./models";

type ModelRegistry = InstanceType<ModelRegistryModule["ModelRegistry"]>;

/** A setting handle that also says which layer gives it its value (src/config/registry.ts `provenance`). */
export interface ProvenancedSetting<T> extends SettingsReader<T> {
	provenance(settings: OmpSettingsInstance): DictationSource;
}
export interface SttSettingsModule {
	cfgSttEnabled: ProvenancedSetting<boolean>;
	cfgSttLanguage: SettingsReader<string>;
}
export interface SttModelsModule {
	/** The speech model omp runs on this computer for catalog id `key`, its default for an unknown or missing one. */
	resolveSttModelSpec(key: string | undefined): { key: string; label: string; sizeHint: string };
}
/** A model with the API omp calls it through, which decides where speech is turned into text. */
export interface ApiModel extends OmpModel {
	api: string;
}
export interface ModelRolesModule {
	/** Every model of the providers you can call that `role` accepts, speech models included. */
	roleCandidatePool(role: string, settings: OmpSettingsInstance, registry: ModelRegistry): ApiModel[];
}
/** omp's native microphone capture with streaming or buffered transcription, opaque to the dashboard. */
export interface SttController {
	readonly brand: "STTController";
}
export interface SttControllerModule {
	STTController: new (dependencies: { settings: OmpSettingsInstance; registry: ModelRegistry }) => SttController;
}
/** The frames omp's RPC mode sends for a capture (src/modes/rpc/rpc-types.ts `RpcDictationFrame`), exactly one `dictation_end` last. */
export type DictationFrame =
	| { type: "dictation_state"; captureId: string; state: "starting" | "recording" | "transcribing" }
	| { type: "dictation_transcript"; captureId: string; text: string }
	| { type: "dictation_end"; captureId: string; text: string; error?: string };
export interface RpcDictationModule {
	/**
	 * One draft-only capture at a time, its preview and end as frames. `session` reaches only the default controller
	 * factory, which the dashboard replaces with its own, so it passes `null`.
	 */
	RpcDictationBridge: new (
		session: null,
		output: (frame: DictationFrame) => void,
		createController: () => SttController,
	) => {
		/** Resolves once the microphone records; rejects after the `dictation_end` frame of a failed or stopped start. */
		start(captureId: string): Promise<void>;
		/** Stops the microphone and waits for the transcript; rejects with the capture's error after its `dictation_end`. */
		stop(): Promise<{ text: string }>;
		/** Closes the microphone now and ends the capture with the text so far; the bridge takes no capture after. */
		dispose(): void;
	};
}
