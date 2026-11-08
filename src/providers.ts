/** Settings › Providers on the server: the providers omp signs in to, the one sign-in under way, sign-outs, and the account order. */
import { listProviders, loginProvider, logoutProvider, orderProviderAccounts } from "./omp/providers";
import { createProviderLogins } from "./provider-logins";
import { Rejected } from "./settings";
import type { AccountOrderEdit, ProviderLogin, ProvidersAnswer } from "./shared/providers";

const logins = createProviderLogins(loginProvider);

/** `GET /api/providers`: every provider with its accounts, and the sign-in the page last started. */
export const loadProviders = async (): Promise<ProvidersAnswer> => ({ providers: await listProviders(), login: logins.state() });

/** Starts `/login` entry `method`, abandoning a sign-in under way. */
export async function startProviderLogin(method: string): Promise<ProvidersAnswer> {
	const providers = await listProviders();
	const provider = providers.find(({ methods }) => methods.some(({ id }) => id === method));
	if (!provider) throw new Rejected(400, `omp's /login offers no provider ${method}`);
	logins.start(provider.id, method);
	return { providers, login: logins.state() };
}

/** Answers the sign-in's open question `prompt`. */
export async function answerProviderLogin({ prompt, value }: { prompt: number; value: string }): Promise<ProviderLogin | null> {
	if (!logins.answer(prompt, value)) throw new Rejected(409, "The sign-in no longer waits on that question.");
	return logins.state();
}

/** Abandons the sign-in under way, or dismisses how the last one ended. */
export async function cancelProviderLogin(): Promise<null> {
	logins.cancel();
	return null;
}

/** Removes `provider`'s stored credential `credentialId`, if it is still there, and answers the providers after. */
export async function signOutProvider({ provider, credentialId }: { provider: string; credentialId: number }): Promise<ProvidersAnswer> {
	await logoutProvider(provider, credentialId);
	return loadProviders();
}

/** Saves the order omp tries `provider`'s accounts in, `emails` the first tried first, and answers the providers after. */
export async function setAccountOrder({ provider, emails }: AccountOrderEdit): Promise<ProvidersAnswer> {
	if (!(await orderProviderAccounts(provider, emails))) throw new Rejected(409, "The signed-in accounts changed. Refresh Providers and try again.");
	return loadProviders();
}
