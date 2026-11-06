import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { toasts } from "./components/toaster";
import { type ActionState, ActionRunner } from "./use-action";

afterEach(() => mock.restore());

/** Runs `action` with `args` and resolves with the state it settles to. */
function settle<A extends unknown[]>(action: ActionRunner<A>, ...args: A): Promise<ActionState<A>> {
	const { promise, resolve } = Promise.withResolvers<ActionState<A>>();
	const stop = action.subscribe(() => {
		if (action.state.kind === "pending") return;
		stop();
		resolve(action.state);
	});
	action.run(...args);
	return promise;
}

test("a second press while the work runs starts nothing", async () => {
	const { promise, resolve } = Promise.withResolvers<void>();
	const work = mock((_: string) => promise);
	const action = new ActionRunner(work, null);
	const settled = settle(action, "first");
	action.run("second");
	expect(work.mock.calls).toEqual([["first"]]);
	expect(action.state).toEqual({ kind: "pending", args: ["first"] });
	resolve();
	expect(await settled).toEqual({ kind: "idle" });
});

test("a failure stays with its arguments until the next run or a dismiss, and toasts only when titled and shown", async () => {
	const added = spyOn(toasts, "add");
	const inline = new ActionRunner(async (_: number) => {
		throw new Error("refused");
	}, null);
	expect(await settle(inline, 7)).toEqual({ kind: "failed", args: [7], error: "refused" });
	inline.dismiss();
	expect(inline.state).toEqual({ kind: "idle" });
	expect(added).not.toHaveBeenCalled();

	const toasted = new ActionRunner(() => {
		throw new Error("thrown at once");
	}, "Could not save");
	expect(await settle(toasted)).toEqual({ kind: "failed", args: [], error: "thrown at once" });
	expect(added).not.toHaveBeenCalled();
	const unsubscribe = toasted.subscribe(() => {});
	await settle(toasted);
	unsubscribe();
	expect(added.mock.calls.map(([toast]) => toast)).toEqual([{ title: "Could not save", description: "thrown at once" }]);
});
