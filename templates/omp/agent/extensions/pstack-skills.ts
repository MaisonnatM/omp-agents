import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { syncPstackSkills } from "./pstack-skills/sync";

export default function pstackSkills(_pi: ExtensionAPI) {
	syncPstackSkills();
}
