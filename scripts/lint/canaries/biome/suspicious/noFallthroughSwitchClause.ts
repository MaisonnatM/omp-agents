export function f(n: number) {
	let x = 0;
	switch (n) {
		case 1:
			x = 1;
		case 2:
			x = 2;
			break;
	}
	return x;
}
