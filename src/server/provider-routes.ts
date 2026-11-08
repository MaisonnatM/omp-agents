import { answerProviderLogin, cancelProviderLogin, loadProviders, setAccountOrder, signOutProvider, startProviderLogin } from "../providers";
import { Rejected } from "../settings";
import { answer, checked, fail } from "./http";
import { parseAccountOrder, parseLoginAnswer, parseLoginMethod, parseProviderSignOut } from "./wire";
import type { RouteKit, Routes } from "./route-kit";

/** The model providers omp's `/login` signs in to. */
export function providerRoutes({ get, write }: RouteKit): Routes {
	const refuse = (err: unknown): Response | null => (err instanceof Rejected ? fail(err.status, err.message) : null);
	return {
		/** Every provider with its stored accounts, and the sign-in the page last started. */
		"/api/providers": { GET: get(() => answer(loadProviders)) },
		/** `{ method }`: starts that `/login` entry, abandoning a sign-in under way. */
		"/api/providers/login": {
			PUT: write((body) => checked(parseLoginMethod(body), "Expected { method } naming a /login provider"), startProviderLogin, refuse),
		},
		/** `{ prompt, value }`: answers the sign-in's open question; 409 once it no longer waits on it. */
		"/api/providers/login/answer": { PUT: write((body) => checked(parseLoginAnswer(body), "Expected { prompt, value }"), answerProviderLogin, refuse) },
		/** Abandons the sign-in under way, or dismisses how the last one ended. */
		"/api/providers/login/cancel": { PUT: write(() => null, cancelProviderLogin) },
		/** `{ provider, credentialId }`: removes that stored credential, as `/logout` does. */
		"/api/providers/sign-out": { PUT: write((body) => checked(parseProviderSignOut(body), "Expected { provider, credentialId }"), signOutProvider) },
		/** `{ provider, emails }`: saves the order omp tries that provider's accounts in; 409 once they changed. */
		"/api/providers/account-order": { PUT: write((body) => checked(parseAccountOrder(body), "Expected { provider, emails }"), setAccountOrder, refuse) },
	};
}
