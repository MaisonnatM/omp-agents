export function f(o?: { g: () => number }) {
	return (o?.g)();
}
