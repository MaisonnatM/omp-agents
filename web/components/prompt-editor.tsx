/**
 * The composer's text field: plain text whose references show as chips. The prompt stays a string: a chip's text is
 * the characters it stands for, so reading the editor gives back exactly what was typed or inserted.
 */
import { HistoryExtension } from "@lexical/history";
import { PlainTextExtension } from "@lexical/plain-text";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import {
	$addUpdateTag,
	$createLineBreakNode,
	$createParagraphNode,
	$createTextNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_LOW,
	DecoratorNode,
	defineExtension,
	type ElementNode,
	KEY_DOWN_COMMAND,
	type NodeKey,
	PASTE_COMMAND,
	type PointType,
	SELECTION_CHANGE_COMMAND,
	type SerializedLexicalNode,
	TextNode,
} from "lexical";
import { type ComponentProps, type JSX, type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { type ChipKind, type PromptToken, promptTokens } from "../prompt-tokens";
import { isChipKind, PromptChip } from "./prompt-chip";

type ChipData = Pick<PromptToken, "kind" | "label" | "target"> & { text: string };

class ChipNode extends DecoratorNode<JSX.Element> {
	__chip: ChipData;

	static getType(): string {
		return "prompt-chip";
	}

	static clone(node: ChipNode): ChipNode {
		return new ChipNode(node.__chip, node.__key);
	}

	static importJSON(json: SerializedLexicalNode & Partial<ChipData>): ChipNode {
		const kind: ChipKind = isChipKind(json.kind) ? json.kind : "file";
		return new ChipNode({ kind, label: json.label ?? "", target: json.target ?? "", text: json.text ?? "" });
	}

	constructor(chip: ChipData, key?: NodeKey) {
		super(key);
		this.__chip = chip;
	}

	exportJSON(): SerializedLexicalNode & ChipData {
		return { ...super.exportJSON(), ...this.__chip };
	}

	createDOM(): HTMLElement {
		return document.createElement("span");
	}

	updateDOM(): boolean {
		return false;
	}

	isInline(): boolean {
		return true;
	}

	/** The arrows step over a chip, as over one character, instead of selecting it, where typing would do nothing. */
	isKeyboardSelectable(): boolean {
		return false;
	}

	getTextContent(): string {
		return this.__chip.text;
	}

	decorate(): JSX.Element {
		return <PromptChip {...this.__chip} />;
	}
}

/** The editor's one paragraph: plain text keeps every line in it, joined by line breaks. */
const $paragraph = (): ElementNode | null => {
	const first = $getRoot().getFirstChild();
	return $isElementNode(first) ? first : null;
};

/** `point` as an offset into the prompt. */
function $offset(point: PointType): number {
	const paragraph = $paragraph();
	if (!paragraph) return 0;
	let offset = 0;
	for (const [index, child] of paragraph.getChildren().entries()) {
		if (point.type === "element" && point.key === paragraph.getKey() && index === point.offset) return offset;
		if (point.type === "text" && child.getKey() === point.key) return offset + point.offset;
		offset += child.getTextContentSize();
	}
	return offset;
}

function $select(offset: number): void {
	const paragraph = $paragraph();
	if (!paragraph) return;
	let at = 0;
	for (const [index, child] of paragraph.getChildren().entries()) {
		const size = child.getTextContentSize();
		if ($isTextNode(child) && offset <= at + size) {
			child.select(offset - at, offset - at);
			return;
		}
		if (!$isTextNode(child) && offset <= at) {
			paragraph.select(index, index);
			return;
		}
		at += size;
	}
	paragraph.selectEnd();
}

function $fill(text: string): void {
	const root = $getRoot();
	root.clear();
	const paragraph = $createParagraphNode();
	text.split("\n").forEach((line, index) => {
		if (index > 0) paragraph.append($createLineBreakNode());
		if (line) paragraph.append($createTextNode(line));
	});
	root.append(paragraph);
}

const $text = (): string => $getRoot().getTextContent();

/** Whether `chip` still reads as its reference beside the text around it: `/move` followed by `X` is `/moveX`. */
function $whole(chip: ChipNode, before: string, after: string): boolean {
	const { text } = chip.__chip;
	const leading = before === "" && chip.getPreviousSibling() === null;
	return promptTokens(before + text + after, { leading }).some(token => token.start === before.length && token.end === before.length + text.length);
}

export interface PromptEditorHandle {
	focus: () => void;
	/** The selection as offsets into the prompt. */
	selection: () => { start: number; end: number };
	/** Focuses the field with the caret at `offset`. */
	select: (offset: number) => void;
	editable: () => boolean;
}

/** Turns each reference typed or inserted into a chip, and keeps the parent's `value` and the editor's text equal. */
function Sync({ value, onChange, disabled, autoFocus, handle }: { value: string; onChange: (text: string) => void; disabled: boolean; autoFocus: boolean; handle?: Ref<PromptEditorHandle> }) {
	const [editor] = useLexicalComposerContext();
	const current = useRef(value);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	/** Set while the parent's value replaces the text: none of it is being typed, so a reference at the caret is whole. */
	const replacing = useRef(false);

	// React focuses only form controls for `autoFocus`; like it, this runs on mount only.
	useEffect(() => {
		if (autoFocus) editor.focus();
	}, [editor]);
	useImperativeHandle(
		handle,
		() => ({
			focus: () => editor.focus(),
			selection: () =>
				editor.getEditorState().read(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return { start: current.current.length, end: current.current.length };
					const [start, end] = [$offset(selection.anchor), $offset(selection.focus)].sort((a, b) => a - b);
					return { start, end };
				}),
			select: offset => {
				editor.update(() => $select(offset), { discrete: true });
				editor.focus();
			},
			editable: () => editor.isEditable(),
		}),
		[editor],
	);

	useEffect(() => editor.setEditable(!disabled), [editor, disabled]);

	useLayoutEffect(() => {
		if (value === editor.getEditorState().read($text)) return;
		current.current = value;
		const focused = editor.getRootElement()?.contains(document.activeElement) ?? false;
		replacing.current = true;
		editor.update(
			() => {
				$fill(value);
				if (focused) $select(value.length);
				else $setSelection(null);
			},
			{ discrete: true, tag: "history-merge" },
		);
		replacing.current = false;
	}, [editor, value]);

	useEffect(() => {
		const offTransform = editor.registerNodeTransform(TextNode, node => {
			if (!node.isSimpleText()) return;
			const text = node.getTextContent();
			// A chip the text now runs into turns back into text, which this transform then reads again as a whole.
			const [previous, next] = [node.getPreviousSibling(), node.getNextSibling()];
			const broken = previous instanceof ChipNode && !$whole(previous, "", text) ? previous : next instanceof ChipNode && !$whole(next, text, "") ? next : null;
			if (broken) {
				broken.replace($createTextNode(broken.__chip.text));
				return;
			}
			const selection = $getSelection();
			const caret =
				$isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.key === node.getKey() ? selection.anchor.offset : null;
			// A folder the `@` menu inserted stays open, so its contents list next.
			const open = replacing.current ? (text.endsWith("/") ? text.length : null) : caret;
			const leading = node.getPreviousSibling() === null;
			const [token] = promptTokens(text, { open, leading });
			if (!token) return;
			const parts = node.splitText(token.start, token.end);
			const chip = new ChipNode({ kind: token.kind, label: token.label, target: token.target, text: text.slice(token.start, token.end) });
			parts[token.start === 0 ? 0 : 1].replace(chip);
			if (caret !== null && caret >= token.start && caret <= token.end) chip.selectNext(0, 0);
		});
		// The composer's own key and paste handlers run first; what they take, the editor leaves alone.
		const offKey = editor.registerCommand(KEY_DOWN_COMMAND, event => event.defaultPrevented, COMMAND_PRIORITY_CRITICAL);
		const offPaste = editor.registerCommand(PASTE_COMMAND, event => event.defaultPrevented, COMMAND_PRIORITY_CRITICAL);
		// A reference ending at the caret may still be written; once the caret moves, it is whole, so its text is read again.
		let caretKey: NodeKey | null = null;
		const offSelection = editor.registerCommand(
			SELECTION_CHANGE_COMMAND,
			() => {
				const left = caretKey === null ? null : $getNodeByKey(caretKey);
				const selection = $getSelection();
				caretKey = $isRangeSelection(selection) ? selection.anchor.key : null;
				if ($isTextNode(left) && left.isAttached()) {
					$addUpdateTag("history-merge");
					left.markDirty();
				}
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);
		const offUpdate = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
			if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
			const text = editorState.read($text);
			if (text === current.current) return;
			current.current = text;
			onChangeRef.current(text);
		});
		// The text the editor starts with was not typed, so each reference in it is whole.
		replacing.current = true;
		editor.update(
			() => {
				for (const node of $getRoot().getAllTextNodes()) node.markDirty();
			},
			{ discrete: true, tag: "history-merge" },
		);
		replacing.current = false;
		return () => {
			offTransform();
			offKey();
			offPaste();
			offSelection();
			offUpdate();
		};
	}, [editor]);

	return null;
}

type EditableProps = Omit<ComponentProps<typeof ContentEditable>, "placeholder" | "aria-placeholder" | "onChange" | "ref">;

interface PromptEditorProps extends EditableProps {
	value: string;
	/** Runs for the user's edits, not for a change of `value`. */
	onValueChange: (text: string) => void;
	disabled?: boolean;
	handle?: Ref<PromptEditorHandle>;
}

export function PromptEditor({ value, onValueChange, disabled = false, autoFocus = false, handle, ...editable }: PromptEditorProps) {
	// Built once: the editor keeps its own text from then on, and `Sync` follows `value`.
	const [extension] = useState(() =>
		defineExtension({
			name: "[root]",
			namespace: "prompt",
			nodes: [ChipNode],
			dependencies: [PlainTextExtension, HistoryExtension],
			editable: !disabled,
			onError: error => console.error(error),
			$initialEditorState: () => $fill(value),
		}),
	);
	return (
		// `null`: the editable renders as a child, since a new `contentEditable` element would build a new editor.
		<LexicalExtensionComposer extension={extension} contentEditable={null}>
			<ContentEditable {...editable} />
			<Sync value={value} onChange={onValueChange} disabled={disabled} autoFocus={autoFocus} handle={handle} />
		</LexicalExtensionComposer>
	);
}
