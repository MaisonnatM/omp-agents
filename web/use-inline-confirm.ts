import { useEffect, useState, type MouseEvent } from "react";

interface ArmedAction {
	scope: string;
	action: string;
	element: HTMLElement;
}

export function useInlineConfirm(scope: string) {
	const [armed, setArmed] = useState<ArmedAction | null>(null);
	const active = armed?.scope === scope ? armed : null;
	useEffect(() => {
		if (!armed) return;
		const disarm = () => setArmed(null);
		if (armed.scope !== scope) {
			disarm();
			return;
		}
		const pointer = (event: PointerEvent) => {
			if (event.target instanceof Node && !armed.element.contains(event.target)) disarm();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			disarm();
		};
		const timeout = window.setTimeout(disarm, 3000);
		document.addEventListener("pointerdown", pointer, true);
		window.addEventListener("keydown", key, true);
		window.addEventListener("blur", disarm);
		return () => {
			window.clearTimeout(timeout);
			document.removeEventListener("pointerdown", pointer, true);
			window.removeEventListener("keydown", key, true);
			window.removeEventListener("blur", disarm);
		};
	}, [armed, scope]);
	return {
		isArmed: (action: string) => active?.action === action,
		props: (action: string, confirm: () => void) => ({
			onClick: (event: MouseEvent<HTMLElement>) => {
				if (active?.action === action && active.element === event.currentTarget) {
					setArmed(null);
					confirm();
				} else setArmed({ scope, action, element: event.currentTarget });
			},
			onBlur: () => setArmed(null),
		}),
	};
}
