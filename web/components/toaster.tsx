import { Toast } from "@base-ui/react/toast";
import { Button } from "@/components/ui/button";

/** The page's toasts: `toasts.add` shows one from anywhere, without rendering its caller again as the toasts change. */
export const toasts = Toast.createToastManager();

/** Every toast of the page, stacked at the bottom right, the newest last. A toast that never times out gets **Dismiss**. */
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
	return Toast.useToastManager().toasts.map(toast => (
		<Toast.Root key={toast.id} toast={toast} className="rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-lg data-limited:hidden">
			<Toast.Content className="flex items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-col">
					<Toast.Title className="truncate" />
					<Toast.Description className="text-muted-foreground" />
				</div>
				<Toast.Action render={<Button variant="secondary" size="compact" />} />
				{toast.timeout === 0 && <Toast.Close render={<Button variant="ghost" size="compact" />}>Dismiss</Toast.Close>}
			</Toast.Content>
		</Toast.Root>
	));
}
