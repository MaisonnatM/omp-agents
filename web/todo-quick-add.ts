import type { UserTodoCategory } from "../src/shared";
import { today } from "./todo-views";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FULL_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function dueOf(word: string, day: string): string | null {
	const lower = word.toLowerCase();
	if (lower === "today") return day;
	if (lower === "tomorrow") {
		const date = new Date(`${day}T12:00:00`);
		date.setDate(date.getDate() + 1);
		return today(date);
	}
	const weekday = WEEKDAYS.indexOf(lower.slice(0, 3));
	if (weekday >= 0 && (lower.length === 3 || FULL_WEEKDAYS[weekday] === lower)) {
		const date = new Date(`${day}T12:00:00`);
		date.setDate(date.getDate() + (weekday - date.getDay() + 7) % 7);
		return today(date);
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(word) && today(new Date(`${word}T12:00:00`)) === word) return word;
	return null;
}

/** Recognized trailing day and #category tokens become fields; unrecognized words stay in the title. */
export function parseQuickTodo(input: string, categories: readonly UserTodoCategory[], day: string): { text: string; due: string | null; categoryId: string | null } | null {
	const words = input.trim().split(/\s+/);
	let due: string | null = null;
	let categoryId: string | null = null;
	while (words.length > 1) {
		const word = words.at(-1)!;
		const category: UserTodoCategory | null = categoryId === null && word.startsWith("#") ? (categories.find(candidate => candidate.name.toLowerCase() === word.slice(1).toLowerCase()) ?? null) : null;
		const parsedDue: string | null = due === null ? dueOf(word, day) : null;
		if (category) categoryId = category.id;
		else if (parsedDue) due = parsedDue;
		else break;
		words.pop();
	}
	const text = words.join(" ");
	return text ? { text, due, categoryId } : null;
}
