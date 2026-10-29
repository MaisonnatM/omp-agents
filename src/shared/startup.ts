/** Only unresolved omp installations use this exit code. Other startup failures keep their diagnostics. */
export const OMP_MISSING_EXIT = 79;
export const OMP_INSTALL_COMMAND = "bun install -g @oh-my-pi/pi-coding-agent";

export class OmpMissing extends Error {}
