/** A web address as the dashboard shows it: the site's icon, then its host with the rest of the address muted. */
import { IconGlobe } from "central-icons";
import { type ReactNode, useState } from "react";
import { mediaSrc } from "../api";
import { cn } from "@/lib/utils";

/** `url`'s parts: `http://` when it is not HTTPS, the host without `www.`, then its path, query, and fragment, without a lone `/`. */
export function addressParts(url: string): { hostname: string; scheme: string; host: string; rest: string } {
	const parsed = new URL(url);
	const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
	return { hostname: parsed.hostname, scheme: parsed.protocol === "https:" ? "" : `${parsed.protocol}//`, host: parsed.host.replace(/^www\./, ""), rest };
}

/**
 * The site's icon, fetched by the server, or `fallback`, a globe by default, when the server finds none or `hostname` is `null`,
 * for a host the server must not learn; `className` sizes the icon.
 */
export function SiteIcon({ hostname, className, fallback }: { hostname: string | null; className?: string; fallback?: ReactNode }) {
	const [failed, setFailed] = useState<string | null>(null);
	if (hostname === null || failed === hostname) return fallback ?? <IconGlobe className="size-3.5 shrink-0 text-muted-foreground" />;
	return <img alt="" src={mediaSrc(`/api/favicon?${new URLSearchParams({ host: hostname })}`)} onError={() => setFailed(hostname)} className={cn("size-3.5 shrink-0 rounded-[3px] object-contain", className)} />;
}

/** `url` as its host, then the rest muted; `className` sets how it wraps or cuts. */
export function SiteAddress({ url, className }: { url: string; className?: string }) {
	const { scheme, host, rest } = addressParts(url);
	return (
		<span className={cn("min-w-0", className)}>
			<span className="text-foreground">
				{scheme}
				{host}
			</span>
			{rest && <span className="text-muted-foreground">{rest}</span>}
		</span>
	);
}
