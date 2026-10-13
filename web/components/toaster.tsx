/** The page's toasts: the `toasts` manager that shows one from anywhere, and `Toaster`, which stacks them bottom right. */
import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** What a toast carries beyond its text: `source`, the line over its title that says where it came from, such as Slack's logo and name. */
export interface ToastData {
	source?: ReactNode;
}

/** The page's toasts: `toasts.add` shows one from anywhere, without rendering its caller again as the toasts change. */
export const toasts = Toast.createToastManager<ToastData>();

/** Every toast of the page, stacked at the bottom right, the newest last, each under its source when it has one. A toast that never times out gets **Dismiss**. */
export function Toaster() {
	return (
		<Toast.Provider toastManager={toasts}>
			<Toast.Portal>
				<Toast.Viewport className="fixed right-4 bottom-10 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col-reverse gap-2">
					<ToastList />
				</Toast.Viewport>
			</Toast.Portal>
		</Toast.Provider>
	);
}

function ToastList() {
	return Toast.useToastManager<ToastData>().toasts.map(toast => (
		<Toast.Root key={toast.id} toast={toast} className="rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-lg data-limited:hidden">
			<Toast.Content className="flex items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-col">
					{toast.data?.source && <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">{toast.data.source}</div>}
					<Toast.Title className="truncate" />
					<Toast.Description className="text-muted-foreground" />
				</div>
				<Toast.Action render={<Button variant="secondary" size="compact" />} />
				{toast.timeout === 0 && <Toast.Close render={<Button variant="ghost" size="compact" />}>Dismiss</Toast.Close>}
			</Toast.Content>
		</Toast.Root>
	));
}
