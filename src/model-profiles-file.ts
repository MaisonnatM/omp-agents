/** The model profiles Settings › Models saved, kept in `model-profiles.json`, and which of them the user's routing matches. */
import { ReducerFile } from "./fs";
import { arrayOf, canonicalJson, fields, isNonEmpty, isObject, isString, recordOf } from "./json";
import type { ModelProfile, ModelProfileSummary, ProfileRouting } from "./shared/models";

type ProfileChange = { kind: "save"; profile: ModelProfile } | { kind: "delete"; name: string };

const isProfile = fields<ModelProfile>({
	name: isNonEmpty,
	modelRoles: recordOf(isString),
	fallbackChains: recordOf(arrayOf(isString)),
	modelProviderOrder: arrayOf(isString),
});

function applyProfileChange(profiles: ModelProfile[], change: ProfileChange): ModelProfile[] {
	switch (change.kind) {
		case "save": {
			const { profile } = change;
			const at = profiles.findIndex(other => other.name === profile.name);
			return at < 0 ? [...profiles, profile] : profiles.with(at, profile);
		}
		case "delete":
			return profiles.some(profile => profile.name === change.name) ? profiles.filter(profile => profile.name !== change.name) : profiles;
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}

/** The routing of a profile or of `config.yml`, as the text two equal routings share whatever order their keys are in. */
const routingKey = ({ modelRoles, fallbackChains, modelProviderOrder }: ProfileRouting): string => canonicalJson({ modelRoles, fallbackChains, modelProviderOrder });

export class ModelProfilesFile extends ReducerFile<ModelProfile[], [ProfileChange]> {
	constructor(path: string) {
		// Shared: every dashboard server on this computer saves into the one file, so each read loads it again.
		super(path, {
			parse: json => (isObject(json) && arrayOf(isProfile)(json.profiles) ? json.profiles : null),
			toJson: profiles => ({ profiles }),
			holds: "a list of model profiles",
			empty: [],
			reduce: applyProfileChange,
			shared: true,
		});
	}

	named(name: string): ModelProfile | undefined {
		this.reload();
		return this.value.find(profile => profile.name === name);
	}

	/** Keeps `routing` as `name`, over the profile of that name if there is one. */
	save(name: string, { modelRoles, fallbackChains, modelProviderOrder }: ProfileRouting): void {
		this.apply({ kind: "save", profile: { name, modelRoles, fallbackChains, modelProviderOrder } });
	}

	delete(name: string): void {
		this.apply({ kind: "delete", name });
	}

	/** Each profile, marked active when it routes as `routing` does. */
	summaries(routing: ProfileRouting): ModelProfileSummary[] {
		this.reload();
		const current = routingKey(routing);
		return this.value.map(profile => ({ name: profile.name, active: routingKey(profile) === current }));
	}
}
