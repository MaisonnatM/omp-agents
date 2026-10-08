import { Check, ListPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { addTodo } from "../../../src/user-todos";
import type { UserTodoLink } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useDashboardActions, useDashboardStatus } from "../dashboard-context";

/** How long the button shows that it added the todo. */
const ADDED_MS = 2000;

interface AddToTodoProps {
	/** The todo's title. */
	text: string;
	/** Its markdown notes. */
	body: string;
	/** What it points to, so the Todo page links back here. */
	link: UserTodoLink;
	/** What the button adds, for its tooltip and screen readers. */
	label: string;
}

/** Adds a todo of no category, last in your list, that links to what the row shows. */
export function AddToTodo({ text, body, link, label }: AddToTodoProps) {
	const { changeTodo } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [added, setAdded] = useState(false);
	useEffect(() => {
		if (!added) return;
		const timer = setTimeout(() => setAdded(false), ADDED_MS);
		return () => clearTimeout(timer);
	}, [added]);
	return (
		<Tooltip content={added ? "Added to your todo list" : label}>
			<Button
				variant="ghost"
				size="icon-compact"
				aria-label={added ? "Added to your todo list" : label}
				disabled={!connected}
				onClick={() => {
					changeTodo(addTodo({ text, body, links: [link] }));
					setAdded(true);
				}}
			>
				{added ? <Check /> : <ListPlus />}
			</Button>
		</Tooltip>
	);
}
