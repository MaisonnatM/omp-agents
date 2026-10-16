/** A project's settings on its page: how many workers run at once, what the coordinator subscribes to, and the review cadence. */
import { useId, useState } from "react";
import { isMaxWorkers, type LinearFilter, MAX_MAX_WORKERS, MAX_REVIEW_CADENCE, type Project, reviewCadence } from "../../../src/shared/projects";
import { cn } from "@/lib/utils";
import { useDashboardActions } from "../dashboard-context";
import { FIELD } from "./project-parts";

/** How many workers the project runs at once, saved as you change it; more wait in the queue. */
export function MaxWorkersField({ project, connected }: { project: Project; connected: boolean }) {
	const { send } = useDashboardActions();
	const id = useId();
	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<label htmlFor={id}>At most</label>
			<input
				id={id}
				type="number"
				min={1}
				max={MAX_MAX_WORKERS}
				value={project.maxWorkers}
				disabled={!connected || project.archived}
				onChange={event => {
					const max = event.target.valueAsNumber;
					if (isMaxWorkers(max) && max !== project.maxWorkers) send({ t: "project", change: { op: "max-workers", id: project.id, max } });
				}}
				className={cn(FIELD, "h-7 w-14 tabular-nums")}
			/>
			<span>workers work or ask at once; the rest wait in the queue.</span>
		</div>
	);
}

/** What the coordinator hears about on its own, and how often it asks the user to review; each saved as it changes. */
export function ProjectSubscriptions({ project, connected }: { project: Project; connected: boolean }) {
	const { send } = useDashboardActions();
	const disabled = !connected || project.archived;
	const { watch } = project;
	const setLinear = (linear: LinearFilter | null) => send({ t: "project", change: { op: "watch", id: project.id, watch: { ...watch, linear } } });
	const filter = watch.linear ?? { team: null, label: null, project: null };
	return (
		<section aria-labelledby="project-subscriptions" className="space-y-3 text-sm">
			<h3 id="project-subscriptions" className="text-sm font-medium">
				Subscriptions
			</h3>
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={watch.pullRequests}
					disabled={disabled}
					onChange={event => send({ t: "project", change: { op: "watch", id: project.id, watch: { ...watch, pullRequests: event.target.checked } } })}
				/>
				Workers' pull requests: checks, reviews, comments, merge, and close
			</label>
			<label className="flex items-center gap-2">
				<input type="checkbox" checked={watch.linear !== null} disabled={disabled} onChange={event => setLinear(event.target.checked ? filter : null)} />
				Linear issues assigned to me
			</label>
			{watch.linear && (
				<div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground">
					{(["team", "label", "project"] as const).map(key => (
						<SavedField
							key={key}
							label={`Linear ${key}`}
							placeholder={`Any ${key}`}
							value={filter[key] ?? ""}
							disabled={disabled}
							onSave={text => setLinear({ ...filter, [key]: text.trim() || null })}
						/>
					))}
				</div>
			)}
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<span>Ask me to review</span>
				<SavedField
					label="Review cadence"
					placeholder="every PR"
					value={project.reviewCadence}
					maxLength={MAX_REVIEW_CADENCE}
					disabled={disabled}
					onSave={text => {
						if (reviewCadence(text) !== project.reviewCadence) send({ t: "project", change: { op: "review-cadence", id: project.id, cadence: text } });
					}}
				/>
			</div>
		</section>
	);
}

/** A one-line field saved on Enter or when it loses focus; Escape puts back `value`. */
function SavedField({ label, placeholder, value, maxLength, disabled, onSave }: { label: string; placeholder: string; value: string; maxLength?: number; disabled: boolean; onSave: (text: string) => void }) {
	const [text, setText] = useState(value);
	return (
		<input
			aria-label={label}
			placeholder={placeholder}
			value={text}
			maxLength={maxLength}
			disabled={disabled}
			onChange={event => setText(event.target.value)}
			onBlur={() => text !== value && onSave(text)}
			onKeyDown={event => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") setText(value);
			}}
			className={cn(FIELD, "h-7 w-40")}
		/>
	);
}
