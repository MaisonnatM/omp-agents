import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { SectionTarget } from "../section";

interface SectionLinkProps {
	/** The page the section is on. */
	href: string;
	section: SectionTarget;
	/** The section a link last chose. */
	chosen: SectionTarget | null;
	title: string;
	label: string;
	count: number;
	/** Gets a new target each time, so choosing a section again scrolls back to it. */
	onChoose: (target: SectionTarget) => void;
}

/** A sidebar link to a section of a page, with its count. A plain click scrolls there; the page listens for `onChoose`. */
export function SectionLink({ href, section, chosen, title, label, count, onChoose }: SectionLinkProps) {
	const isChosen = chosen?.id === section.id;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild isActive={isChosen}>
				<a
					href={href}
					aria-controls={section.id}
					aria-current={isChosen ? "location" : undefined}
					aria-label={label}
					onClick={event => {
						// Modified and middle clicks keep the link's own new-tab behavior.
						if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
						event.preventDefault();
						onChoose({ ...section });
					}}
				>
					{title}
				</a>
			</SidebarMenuButton>
			<SidebarMenuBadge aria-hidden>{count}</SidebarMenuBadge>
		</SidebarMenuItem>
	);
}
