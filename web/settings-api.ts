/** The settings page's requests. */
import type { CatalogModel, FileEdit, OmpSettings, RoutingEdit } from "../src/shared";
import { getJson, putJson } from "./api";

const query = (cwd: string | null): string => (cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`);

export const loadSettings = (cwd: string | null, signal: AbortSignal): Promise<OmpSettings> => getJson<OmpSettings>(`/api/settings${query(cwd)}`, signal);

export const loadModels = async (): Promise<CatalogModel[]> => (await getJson<{ models: CatalogModel[] }>("/api/models")).models;

/** Each save answers with the settings as they load afterwards. */
export const saveRouting = (cwd: string | null, edit: RoutingEdit): Promise<OmpSettings> => putJson(`/api/settings/routing${query(cwd)}`, edit);
export const saveFile = (cwd: string | null, edit: FileEdit): Promise<OmpSettings> => putJson(`/api/settings/file${query(cwd)}`, edit);
