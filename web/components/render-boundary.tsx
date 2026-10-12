import { Component, type ReactNode } from "react";

interface RenderBoundaryProps {
	/** What the boundary shows, such as a pane's view or the page's route; a new key clears a caught error, so showing something else renders again. */
	resetKey: string;
	/** Controls kept above the error, such as a pane's close button, so a view that failed can still be left. */
	actions?: ReactNode;
	children: ReactNode;
}

interface RenderBoundaryState {
	error: Error | null;
	resetKey: string;
}

/**
 * Keeps a render error inside one view, a pane or the page, so it does not unmount the whole dashboard: the view says
 * it failed, with the error's text, and the sidebar and the other panes stay. React logs the error with its component stack.
 */
export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
	override state: RenderBoundaryState = { error: null, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: unknown): Partial<RenderBoundaryState> {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}

	static getDerivedStateFromProps(props: RenderBoundaryProps, state: RenderBoundaryState): Partial<RenderBoundaryState> | null {
		return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
	}

	override render(): ReactNode {
		const { error } = this.state;
		if (error === null) return this.props.children;
		return (
			<>
				{this.props.actions && <div className="flex shrink-0 justify-end gap-1 p-1">{this.props.actions}</div>}
				<div role="alert" className="m-auto w-full min-w-0 max-w-lg space-y-2 p-8 text-sm">
					<p className="font-medium text-foreground">This view failed to render.</p>
					<pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{error.message}</pre>
				</div>
			</>
		);
	}
}
