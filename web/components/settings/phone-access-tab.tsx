/** Settings › Phone access: Tailscale Serve, a one-time pairing code as a QR, and the paired phones. */
import { useEffect, useState } from "react";
import { renderSVG } from "uqr";
import { age } from "../../labels";
import { getJson, putJson } from "../../api";
import { useAction } from "../../use-action";
import { Button } from "@/components/ui/button";
import { ErrorText, Section } from "./editor";
import { ToggleSwitch } from "../toggle-switch";

/** What `GET /api/phone-access` answers. */
interface PhoneAccessView {
	enabled: boolean;
	dnsName: string | null;
	tailscale: string | null;
	phones: { id: string; name: string; pairedAt: string; lastSeenAt: string | null }[];
}

/** A pairing code the tab shows until it expires. */
interface Pairing {
	url: string;
	expiresAt: number;
}

const TAILSCALE_SITE = "https://tailscale.com/download";

/** How long the code has left, counted down once a second. */
function useCountdown(expiresAt: number | null): number {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (expiresAt === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [expiresAt]);
	return expiresAt === null ? 0 : Math.max(0, expiresAt - now);
}

/** The QR of `url`, as SVG. */
function Qr({ url }: { url: string }) {
	return <span aria-label="Pairing code" role="img" className="inline-block size-48 shrink-0 rounded-md bg-white p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: renderSVG(url, { ecc: "M" }) }} />;
}

/** Phone access: off until the switch turns it on, then the address, a pairing code, and the phones. */
export function PhoneAccessTab({ active }: { active: boolean }) {
	const [view, setView] = useState<PhoneAccessView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pairing, setPairing] = useState<Pairing | null>(null);
	const left = useCountdown(pairing?.expiresAt ?? null);

	useEffect(() => {
		if (!active) return;
		const controller = new AbortController();
		getJson<PhoneAccessView>("/api/phone-access", controller.signal).then(
			next => {
				setView(next);
				setError(null);
			},
			(err: unknown) => setError(err instanceof Error ? err.message : String(err)),
		);
		return () => controller.abort();
	}, [active]);

	const toggle = useAction(async (enabled: boolean) => {
		setView(await putJson<PhoneAccessView>("/api/phone-access", { enabled }));
		if (!enabled) setPairing(null);
	}, null);
	const pair = useAction(async () => {
		setPairing(await putJson<Pairing>("/api/phone-access/pairing", {}));
	}, null);
	const remove = useAction(async (id: string) => {
		setView(await putJson<PhoneAccessView>("/api/phone-access/devices", { id }));
	}, null);

	const pending = toggle.pending || pair.pending;
	const shown = pairing && left > 0 ? pairing : null;
	const minutes = Math.floor(left / 60_000);
	const seconds = Math.floor((left % 60_000) / 1000);

	return (
		<>
			<Section
				title="Phone access"
				meta="Open the dashboard on your own phone, through Tailscale, from anywhere. Off, nothing outside this Mac can reach it."
				actions={<ToggleSwitch checked={view?.enabled ?? false} disabled={view === null || pending} onCheckedChange={checked => void toggle.run(checked)} aria-label="Phone access" />}
			>
				{error && <ErrorText>{error}</ErrorText>}
				{toggle.error && <ErrorText>{toggle.error}</ErrorText>}
				{view && !view.enabled && view.tailscale && (
					<p className="text-xs text-muted-foreground">
						{view.tailscale}{" "}
						<a className="underline" href={TAILSCALE_SITE} target="_blank" rel="noreferrer">
							Get Tailscale
						</a>
					</p>
				)}
				{view?.enabled && view.dnsName && (
					<p className="text-xs text-muted-foreground">
						Your phones open <span className="text-foreground">https://{view.dnsName}</span>, and only your Tailscale devices can.
					</p>
				)}
			</Section>
			{view?.enabled && (
				<Section title="Pair a phone" meta="The code works once and expires after 5 minutes. The phone keeps its own key, never this Mac's.">
					{pair.error && <ErrorText>{pair.error}</ErrorText>}
					{shown ? (
						<div className="flex items-start gap-4">
							<Qr url={shown.url} />
							<div className="space-y-1 text-xs">
								<p className="break-all text-foreground">{shown.url}</p>
								<p className="tabular-nums text-muted-foreground">
									Expires in {minutes}:{String(seconds).padStart(2, "0")}
								</p>
							</div>
						</div>
					) : (
						<Button type="button" variant="outline" size="sm" disabled={pair.pending} onClick={() => void pair.run()}>
							Pair a phone
						</Button>
					)}
				</Section>
			)}
			{view?.enabled && (
				<Section title="Paired phones" meta={view.phones.length === 0 ? "None yet." : undefined}>
					<ul className="space-y-2">
						{view.phones.map(phone => (
							<li key={phone.id} className="flex items-center justify-between gap-4 text-sm">
								<span>
									{phone.name}
									<span className="ml-2 text-xs text-muted-foreground">
										{phone.lastSeenAt ? `last connected ${age(Date.parse(phone.lastSeenAt))} ago` : "never connected"}
									</span>
								</span>
								<Button type="button" variant="ghost" size="sm" disabled={remove.pending} onClick={() => void remove.run(phone.id)}>
									Remove
								</Button>
							</li>
						))}
					</ul>
					{remove.error && <ErrorText>{remove.error}</ErrorText>}
				</Section>
			)}
		</>
	);
}
