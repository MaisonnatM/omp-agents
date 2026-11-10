import type { Element, Root } from "hast";

/** A bullet that opens with a bold key: the key, then the rest wrapped as one `rest` span, so the two lay out as columns. */
function keyItem(item: Element) {
	const first = item.children.find(child => child.type === "element" || (child.type === "text" && child.value.trim() !== ""));
	if (first?.type !== "element" || first.tagName !== "strong") return;
	const at = item.children.indexOf(first);
	item.properties.dataPart = "keyed";
	item.children = [first, { type: "element", tagName: "span", properties: { dataPart: "rest" }, children: item.children.slice(at + 1) }];
}

/** Marks each top-level bullet of a reply that opens with a bold key as `keyed`, so the key reads as its own column. */
export const rehypeReplyParts = () => (root: Root) => {
	for (const block of root.children)
		if (block.type === "element" && block.tagName === "ul") for (const item of block.children) if (item.type === "element") keyItem(item);
};
