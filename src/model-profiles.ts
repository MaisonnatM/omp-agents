/** The model profiles Settings › Models saved, kept in `model-profiles.json`, and which of them the user's routing matches. */
import { ReducerFile } from "./fs";
import { arrayOf, canonicalJson, fields, isNonEmpty, isObject, isString, recordOf } from "./json";
import { modelProfilesFile } from "./paths";
import type { ModelProfile, ModelRouting, ProfileRouting } from "./shared/models";

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

let file: ReducerFile<ModelProfile[], [ProfileChange]> | undefined;

/** Read again on every use: shared, since every dashboard server on this computer saves into the one file. */
function profilesFile(): ReducerFile<ModelProfile[], [ProfileChange]> {
	file ??= new ReducerFile(modelProfilesFile, {
		parse: json => (isObject(json) && arrayOf(isProfile)(json.profiles) ? json.profiles : null),
		toJson: profiles => ({ profiles }),
		holds: "a list of model profiles",
		empty: [],
		reduce: applyProfileChange,
		shared: true,
	});
	file.reload();
	return file;
}

export const modelProfile = (name: string): ModelProfile | undefined => profilesFile().value.find(profile => profile.name === name);

/** Keeps `routing` as `name`, over the profile of that name if there is one. */
export function saveModelProfile(name: string, { modelRoles, fallbackChains, modelProviderOrder }: ProfileRouting): void {
	profilesFile().apply({ kind: "save", profile: { name, modelRoles, fallbackChains, modelProviderOrder } });
}

export function deleteModelProfile(name: string): void {
	profilesFile().apply({ kind: "delete", name });
}

/** Each profile, marked active when it routes as `routing` does; the order of keys in a record does not matter. */
export function profilesFor(routing: ProfileRouting): ModelRouting["profiles"] {
	const current = canonicalJson(routing);
	return profilesFile().value.map(({ name, ...profile }) => ({ name, active: canonicalJson(profile) === current }));
}
