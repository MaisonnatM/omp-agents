import { Check, ChevronsUpDown, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { usePinnedSkill } from "../../pinned-skill";
import { useSkills } from "../../use-skills";
import { Section } from "./editor";

/**
 * The skill every session the dashboard starts goes through, kept in this browser. It lists the skills of `cwd`, the
 * workspace the settings show, else the user's own.
 */
export function NewSessionsTab({ cwd }: { cwd: string | null }) {
	const [pinned, pin] = usePinnedSkill();
	const [open, setOpen] = useState(false);
	const list = useSkills(cwd ?? "~");
	const choose = (next: string | null): void => {
		setOpen(false);
		pin(next);
	};
	return (
		<Section
			title="Pinned skill"
			meta="The first message of every session you start here, a quick action's included, goes through this skill. Saved in this browser."
		>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button variant="ghost" size="compact" leadingIcon={Sparkles} trailingIcon={ChevronsUpDown} aria-label={`Pinned skill: ${pinned ?? "none"}`} active={open}>
						<span className="max-w-64 truncate">{pinned ?? "None"}</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
					<Command>
						<CommandInput aria-label="Search skills" placeholder="Search skills…" />
						<CommandList>
							{list === null ? (
								<p role="status" className="py-6 text-center text-sm text-muted-foreground">
									Loading skills…
								</p>
							) : list.error ? (
								<p role="alert" className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">
									{list.error}
								</p>
							) : (
								<>
									<CommandEmpty>No skill matches.</CommandEmpty>
									<CommandGroup>
										<CommandItem value="None" onSelect={() => choose(null)}>
											None
											<Check className={cn("ml-auto", pinned === null ? "opacity-100" : "opacity-0")} />
										</CommandItem>
									</CommandGroup>
									<CommandGroup heading="Skills">
										{list.skills.map(skill => (
											<CommandItem key={skill.name} value={skill.name} onSelect={() => choose(skill.name)}>
												<span className="shrink-0">{skill.name}</span>
												{skill.description && <span className="min-w-0 truncate text-xs text-muted-foreground">{skill.description}</span>}
												<Check className={cn("ml-auto shrink-0", skill.name === pinned ? "opacity-100" : "opacity-0")} />
											</CommandItem>
										))}
									</CommandGroup>
								</>
							)}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
			{pinned !== null && list !== null && !list.error && !list.skills.some(skill => skill.name === pinned) && (
				<p className="text-xs text-muted-foreground">No skill named {pinned} here. A session in a directory without it starts without it.</p>
			)}
		</Section>
	);
}
