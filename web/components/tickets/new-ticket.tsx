import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Box, ChevronRight, CircleUser, Maximize2, Minimize2, Paperclip, Tag, UsersRound, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { errorText } from "../../../src/json";
import { MAX_TICKET_ATTACHMENT_BYTES, type TicketChoice, type TicketDraft, type TicketLabel, type TicketOptions, type TicketPriority, type TicketStatus, type TicketTeam } from "../../../src/shared/tickets";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { putJson } from "../../api";
import { ticketsStore, useRead } from "../../reads";
import { hashForTickets } from "../../routing";
import { chordLabel } from "../../shortcuts";
import { PRIORITY_LABEL, statusOrder } from "../../tickets-model";
import { fileBase64 } from "../prompt-attachments";
import { DuePicker, FieldPicker } from "../field-picker";
import { PRIORITIES } from "./ticket-fields";
import { LabelDot, PRIORITY_ICON, statusIcon } from "./ticket-row";
import { preferredTeam, rememberTeam } from "./team-select";

const MAX_ATTACHMENT_MB = MAX_TICKET_ATTACHMENT_BYTES / (1024 * 1024);

/** Where the form stands: being written, sent to Linear, refused with Linear's reason, or opened while the dialog stays for the next one. */
type Submit =
	| { kind: "writing" }
	| { kind: "creating" }
	| { kind: "failed"; error: string }
	/** `refused` names each file Linear did not attach, with its reason. */
	| { kind: "created"; identifier: string; refused: string[] };

/** The new issue's fields the pills set. `assignee` is `"me"` until another is picked, as the issue opens assigned to you. */
interface Fields {
	/** `null` keeps the status the pill shows first, {@link firstStatus}. */
	state: string | null;
	priority: TicketPriority;
	assignee: TicketChoice | "me" | null;
	labels: TicketLabel[];
	project: string | null;
	dueDate: string | null;
}

const NO_FIELDS: Fields = { state: null, priority: 0, assignee: "me", labels: [], project: null, dueDate: null };

/** The status a new issue starts in, as Linear's dialog shows it: the team's first backlog state, else its first state. */
function firstStatus(statuses: TicketStatus[]): TicketStatus | undefined {
	const sorted = statuses.toSorted(statusOrder);
	return sorted.find(status => status.statusType === "backlog") ?? sorted[0];
}

const isSubmitChord = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.metaKey || event.ctrlKey);

const ERROR_TEXT = "text-xs text-red-600 dark:text-red-400";

/**
 * Linear's new-issue dialog: the team, a title, a markdown description, a pill for each field, and files to attach,
 * starting from `title`. The issue opens assigned to you unless another assignee is picked, then its details open,
 * or with Create more on the dialog stays for the next issue.
 */
export function NewTicketDialog({ title, onClose }: { title: string; onClose: () => void }) {
	const [creating, setCreating] = useState(false);
	const [expanded, setExpanded] = useState(false);
	return (
		<DialogPrimitive.Root open onOpenChange={open => !open && !creating && onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 dark:bg-black/80" />
				<DialogPrimitive.Content
					aria-describedby={undefined}
					className={cn(
						"fixed left-1/2 z-50 flex max-h-[calc(100vh-2rem)] -translate-x-1/2 flex-col overflow-y-auto rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-hidden",
						expanded ? "top-[5vh] h-[90vh] w-[min(60rem,calc(100vw-2rem))]" : "top-[15%] w-[min(44rem,calc(100vw-2rem))]",
					)}
				>
					<NewTicketForm
						title={title}
						onCreating={setCreating}
						onCreated={onClose}
						actions={
							<>
								<Tooltip content={expanded ? "Shrink the dialog" : "Expand the dialog"} side="bottom">
									<Button variant="ghost" size="icon-compact" aria-label={expanded ? "Shrink" : "Expand"} onClick={() => setExpanded(!expanded)}>
										{expanded ? <Minimize2 /> : <Maximize2 />}
									</Button>
								</Tooltip>
								<Tooltip content="Close" shortcut={["Esc"]} side="bottom">
									<DialogPrimitive.Close asChild>
										<Button variant="ghost" size="icon-compact" aria-label="Close" disabled={creating}>
											<X />
										</Button>
									</DialogPrimitive.Close>
								</Tooltip>
							</>
						}
					/>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

interface NewTicketFormProps {
	title: string;
	onCreating: (creating: boolean) => void;
	onCreated: () => void;
	/** The header's buttons at its end. */
	actions: ReactNode;
}

function NewTicketForm({ title: initialTitle, onCreating, onCreated, actions }: NewTicketFormProps) {
	const teams = useRead<TicketTeam[]>("/api/linear/teams");
	const [title, setTitle] = useState(initialTitle);
	const [description, setDescription] = useState("");
	const [picked, setPicked] = useState<string | null>(null);
	const [fields, setFields] = useState<Fields>(NO_FIELDS);
	const [files, setFiles] = useState<File[]>([]);
	const [fileNote, setFileNote] = useState<string | null>(null);
	const [createMore, setCreateMore] = useState(false);
	const [submit, setSubmit] = useState<Submit>({ kind: "writing" });
	const [retry, setRetry] = useState(0);
	const titleRef = useRef<HTMLTextAreaElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const teamId = picked ?? (teams.data?.length ? preferredTeam(teams.data) : null);
	const team = teams.data?.find(candidate => candidate.id === teamId) ?? null;
	const options = useRead<TicketOptions>(team ? `/api/ticket/options?${new URLSearchParams({ team: team.id })}` : null, retry);
	const status = (fields.state !== null ? options.data?.statuses.find(candidate => candidate.status === fields.state) : undefined) ?? (options.data ? firstStatus(options.data.statuses) : undefined);
	const creating = submit.kind === "creating";
	const ready = title.trim() !== "" && team !== null && !creating;
	const set = (change: Partial<Fields>): void => setFields(current => ({ ...current, ...change }));
	const openOptions = (): void => {
		if (options.error) setRetry(count => count + 1);
	};

	const create = async (): Promise<void> => {
		if (!ready) return;
		setSubmit({ kind: "creating" });
		onCreating(true);
		const draft: TicketDraft = {
			title: title.trim(),
			description,
			team: team.id,
			...(status && { state: status.status }),
			...(fields.priority !== 0 && { priority: fields.priority }),
			...(fields.assignee !== "me" && { assignee: fields.assignee?.id ?? null }),
			...(fields.labels.length > 0 && { labels: fields.labels.map(label => label.name) }),
			...(fields.project && { project: fields.project }),
			...(fields.dueDate && { dueDate: fields.dueDate }),
		};
		let identifier: string;
		try {
			({ identifier } = await putJson<{ identifier: string }>("/api/ticket/new", draft));
		} catch (err) {
			setSubmit({ kind: "failed", error: errorText(err) });
			onCreating(false);
			return;
		}
		rememberTeam(team.id);
		const refused: string[] = [];
		for (const file of files) {
			try {
				await putJson<object>("/api/ticket/attachment", { issue: identifier, name: file.name, type: file.type || "application/octet-stream", data: await fileBase64(file) });
			} catch (err) {
				refused.push(`${file.name} (${errorText(err)})`);
			}
		}
		void ticketsStore.refresh(null, { fresh: true });
		onCreating(false);
		if (!createMore && refused.length === 0) {
			onCreated();
			location.hash = hashForTickets(identifier);
			return;
		}
		// The issue exists either way, so the dialog clears for the next one rather than offering to send this one again.
		setTitle("");
		setDescription("");
		setFiles([]);
		setFileNote(null);
		setSubmit({ kind: "created", identifier, refused });
		titleRef.current?.focus();
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		if (!isSubmitChord(event)) return;
		event.preventDefault();
		void create();
	};

	const addFiles = (added: File[]): void => {
		const tooLarge = added.filter(file => file.size > MAX_TICKET_ATTACHMENT_BYTES).map(file => file.name);
		setFileNote(tooLarge.length > 0 ? `Linear takes files of up to ${MAX_ATTACHMENT_MB} MB here, so ${tooLarge.join(", ")} stayed out.` : null);
		setFiles(current => [...current, ...added.filter(file => file.size <= MAX_TICKET_ATTACHMENT_BYTES)]);
	};

	const [StatusIcon, statusColor] = status ? statusIcon(status) : statusIcon({ status: "Backlog", statusType: "backlog" });
	const [PriorityIcon, priorityColor] = PRIORITY_ICON[fields.priority];
	const assigneeName = fields.assignee === "me" ? "Me" : (fields.assignee?.name ?? null);
	const labelNames = fields.labels.map(label => label.name);
	const pickersOff = creating || team === null;

	return (
		<form
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={event => {
				event.preventDefault();
				void create();
			}}
		>
			<div className="flex items-center gap-1.5 px-4 pt-3.5 text-[13px]">
				{teams.data?.length && team ? (
					<FieldPicker
						look="chip"
						field="Team"
						current={team.name}
						trigger={
							<>
								<UsersRound aria-hidden className="size-3.5 text-violet-500" />
								<span className="font-medium">{team.key}</span>
							</>
						}
						choices={teams.data.map(candidate => ({ value: candidate.id, label: `${candidate.name} (${candidate.key})` }))}
						selected={[team.id]}
						disabled={creating}
						onPick={id => {
							if (id === team.id) return;
							setPicked(id);
							// Statuses, labels, and projects belong to a team, so another team's choices start afresh.
							set({ state: null, labels: [], project: null });
						}}
					/>
				) : (
					<span className={teams.error || teams.data ? ERROR_TEXT : "text-muted-foreground"}>
						{teams.error ? `Cannot read Linear's teams: ${teams.error}` : teams.data ? "Linear lists no team to open the issue in." : "Reading teams…"}
					</span>
				)}
				<ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
				<DialogPrimitive.Title className="font-normal text-foreground">New issue</DialogPrimitive.Title>
				<div className="ml-auto flex items-center gap-0.5">{actions}</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-5 pt-3">
				<textarea
					ref={titleRef}
					autoFocus
					rows={1}
					aria-label="Title"
					placeholder="Issue title"
					value={title}
					readOnly={creating}
					onChange={event => setTitle(event.target.value.replaceAll("\n", " "))}
					onKeyDown={event => {
						if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
							event.preventDefault();
							descriptionRef.current?.focus();
						} else onKeyDown(event);
					}}
					className="field-sizing-content resize-none bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground/70 read-only:opacity-60"
				/>
				<textarea
					ref={descriptionRef}
					aria-label="Description"
					placeholder="Add description…"
					value={description}
					readOnly={creating}
					onChange={event => setDescription(event.target.value)}
					onKeyDown={onKeyDown}
					className="field-sizing-content min-h-16 flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 read-only:opacity-60"
				/>
				{files.length > 0 && (
					<ul aria-label="Files to attach" className="flex flex-wrap gap-1.5 py-1">
						{files.map((file, index) => (
							<li key={`${file.name}-${index}`} className="flex h-6 items-center gap-1 rounded-full border border-border pr-0.5 pl-2.5 text-xs">
								<Paperclip aria-hidden className="size-3 text-muted-foreground" />
								<span className="max-w-48 truncate">{file.name}</span>
								<Button type="button" variant="ghost" size="icon-compact" className="size-5 rounded-full" aria-label={`Remove ${file.name}`} disabled={creating} onClick={() => setFiles(current => current.filter((_, at) => at !== index))}>
									<X />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
				<FieldPicker
					look="chip"
					field="Status"
					current={status?.status ?? "team's default"}
					trigger={
						<>
							<StatusIcon aria-hidden className={cn("size-3.5", statusColor)} />
							<span className="truncate">{status?.status ?? "Status"}</span>
						</>
					}
					choices={
						options.data?.statuses.toSorted(statusOrder).map(candidate => {
							const [Icon, color] = statusIcon(candidate);
							return { value: candidate.status, label: candidate.status, icon: <Icon aria-hidden className={color} /> };
						}) ?? null
					}
					error={options.error}
					selected={status ? [status.status] : []}
					disabled={pickersOff}
					onOpen={openOptions}
					onPick={name => set({ state: name })}
				/>
				<FieldPicker
					look="chip"
					field="Priority"
					current={PRIORITY_LABEL[fields.priority]}
					trigger={
						<>
							<PriorityIcon aria-hidden className={cn("size-3.5", priorityColor)} />
							<span className="truncate">{fields.priority === 0 ? "Priority" : PRIORITY_LABEL[fields.priority]}</span>
						</>
					}
					choices={PRIORITIES.map(priority => {
						const [Icon, color] = PRIORITY_ICON[priority];
						return { value: String(priority), label: PRIORITY_LABEL[priority], icon: <Icon aria-hidden className={color} /> };
					})}
					selected={[String(fields.priority)]}
					disabled={creating}
					onPick={value => set({ priority: PRIORITIES.find(priority => String(priority) === value) ?? 0 })}
				/>
				<FieldPicker
					look="chip"
					field="Assignee"
					current={assigneeName ?? "unassigned"}
					trigger={
						<>
							<CircleUser aria-hidden className="size-3.5 text-muted-foreground" />
							<span className="truncate">{assigneeName ?? "Assignee"}</span>
						</>
					}
					choices={options.data ? [{ value: "me", label: "Me" }, { value: "", label: "No assignee" }, ...options.data.users.map(user => ({ value: user.id, label: user.name }))] : null}
					error={options.error}
					selected={[fields.assignee === "me" ? "me" : (fields.assignee?.id ?? "")]}
					disabled={pickersOff}
					onOpen={openOptions}
					onPick={id => set({ assignee: id === "me" ? "me" : (options.data?.users.find(user => user.id === id) ?? null) })}
				/>
				<FieldPicker
					look="chip"
					field="Project"
					current={fields.project ?? "none"}
					trigger={
						<>
							<Box aria-hidden className="size-3.5 text-muted-foreground" />
							<span className="truncate">{fields.project ?? "Project"}</span>
						</>
					}
					choices={options.data ? [{ value: "", label: "No project" }, ...options.data.projects.map(name => ({ value: name, label: name }))] : null}
					error={options.error}
					selected={[fields.project ?? ""]}
					disabled={pickersOff}
					onOpen={openOptions}
					onPick={name => set({ project: name || null })}
				/>
				<FieldPicker
					look="chip"
					field="Labels"
					current={labelNames.join(", ") || "none"}
					trigger={
						<>
							{fields.labels.length > 0 ? (
								<span className="flex items-center -space-x-0.5">
									{fields.labels.map(label => (
										<LabelDot key={label.name} color={label.color} />
									))}
								</span>
							) : (
								<Tag aria-hidden className="size-3.5 text-muted-foreground" />
							)}
							<span className="truncate">{fields.labels.length === 0 ? "Labels" : fields.labels.length === 1 ? labelNames[0] : `${fields.labels.length} labels`}</span>
						</>
					}
					choices={options.data?.labels.map(label => ({ value: label.name, label: label.name, icon: <LabelDot color={label.color} /> })) ?? null}
					error={options.error}
					selected={labelNames}
					multi
					disabled={pickersOff}
					onOpen={openOptions}
					onPick={name =>
						set({
							labels: labelNames.includes(name) ? fields.labels.filter(label => label.name !== name) : [...fields.labels, options.data?.labels.find(label => label.name === name) ?? { name, color: "" }],
						})
					}
				/>
				<DuePicker look="chip" dueDate={fields.dueDate} disabled={creating} onChange={dueDate => set({ dueDate })} />
			</div>
			{(submit.kind === "failed" || submit.kind === "created" || fileNote) && (
				<div className="flex flex-col gap-1 px-5 pb-2">
					{submit.kind === "failed" && (
						<p role="alert" className={ERROR_TEXT}>
							{submit.error}
						</p>
					)}
					{submit.kind === "created" &&
						(submit.refused.length > 0 ? (
							<p role="alert" className={ERROR_TEXT}>
								Opened <a href={hashForTickets(submit.identifier)} className="underline">{submit.identifier}</a>, but Linear did not attach {submit.refused.join(", ")}.
							</p>
						) : (
							<p role="status" className="text-xs text-muted-foreground">
								Opened <a href={hashForTickets(submit.identifier)} className="text-foreground underline-offset-2 hover:underline">{submit.identifier}</a>.
							</p>
						))}
					{fileNote && <p className={ERROR_TEXT}>{fileNote}</p>}
				</div>
			)}
			<div className="flex items-center gap-3 border-t border-border px-4 py-3">
				<input
					ref={fileRef}
					type="file"
					multiple
					hidden
					onChange={event => {
						addFiles([...(event.target.files ?? [])]);
						event.target.value = "";
					}}
				/>
				<Tooltip content={`Attach files, up to ${MAX_ATTACHMENT_MB} MB each`} side="top">
					<Button type="button" variant="ghost" size="icon-compact" className="rounded-full" aria-label="Attach files" disabled={creating} onClick={() => fileRef.current?.click()}>
						<Paperclip />
					</Button>
				</Tooltip>
				<label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
					<button
						type="button"
						role="switch"
						aria-checked={createMore}
						onClick={() => setCreateMore(!createMore)}
						className="group inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-primary motion-reduce:transition-none"
					>
						<span className="size-3 rounded-full bg-background shadow-xs transition-transform group-aria-checked:translate-x-3 motion-reduce:transition-none" />
					</button>
					Create more
				</label>
				<Tooltip content="Create issue" shortcut={[chordLabel({ key: "Enter", mod: true })]} side="top" disabled={!ready}>
					<Button type="submit" size="compact" className="rounded-full" loading={creating} disabled={!ready}>
						Create issue
					</Button>
				</Tooltip>
			</div>
		</form>
	);
}
