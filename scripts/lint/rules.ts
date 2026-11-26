import type { Rule } from "./rule";
import { fileSize } from "./rules/file-size";
import { glossaryTerms } from "./rules/glossary-terms";
import { keymapOwner } from "./rules/keymap-owner";
import { ompSeam } from "./rules/omp-seam";

/** Every rule `scripts/lint/run.ts` runs; add a rule's module here with its canary. */
export const RULES: Rule[] = [fileSize, glossaryTerms, keymapOwner, ompSeam];
