/**
 * Whether Enter on the empty composer delivers a steer that is waiting on the running turn.
 *
 * `armed`: the user just steered, or the steering queue still holds it. Enter aborts the turn
 * and omp runs that steer at once. `settling`: that abort, or Esc, is already in flight, so
 * another Enter waits until the queue clears instead of stopping the turn that delivers it.
 */
export type SteerDelivery = "idle" | "armed" | "settling";

export type SteerDeliveryEvent =
	| { t: "steer" }
	| { t: "queue"; steering: number }
	| { t: "working"; working: boolean }
	| { t: "flush" }
	| { t: "interrupt" };

export function steerDelivery(phase: SteerDelivery, event: SteerDeliveryEvent): SteerDelivery {
	switch (event.t) {
		case "steer":
			return "armed";
		case "flush":
		case "interrupt":
			return phase === "idle" ? "idle" : "settling";
		case "working":
			return !event.working && phase === "armed" ? "idle" : phase;
		case "queue":
			if (phase === "settling") return event.steering > 0 ? "settling" : "idle";
			if (event.steering > 0) return "armed";
			return phase === "armed" ? "idle" : phase;
	}
}
