import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptFileChips } from "./prompt-file-chips";

test("each attached file is a button that names the file it opens and counts as an activity control", () => {
	const html = renderToStaticMarkup(<PromptFileChips files={[{ name: "Pasted text.txt", text: "a" }, { name: "notes.md", text: "b" }]} onOpen={() => {}} />);
	expect(html.match(/aria-label="[^"]+"/g)).toEqual(['aria-label="Open Pasted text.txt"', 'aria-label="Open notes.md"']);
	expect(html.match(/data-activity="file-dialog.open-attached"/g)).toHaveLength(2);
});
