import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";

/**
 * A brand's mark as its own SVG markup, in the brand's colors; black parts take the text color.
 * `monoInDark` draws a dark-colored mark in the text color under the dark theme, where its color would vanish.
 */
export interface BrandLogo {
	svg: string;
	monoInDark?: boolean;
}

/** Draws `logo` at `size`, else the size `className` gives; the markup is ours, from the constants in this folder, never user input. */
export function BrandMark({ logo, className, size }: { logo: BrandLogo; className?: string; size?: number | string }) {
	return (
		<span
			aria-hidden
			className={cn("flex shrink-0 [&>svg]:size-full", logo.monoInDark && "dark:[&_*]:fill-current", className)}
			style={size === undefined ? undefined : { width: size, height: size }}
			dangerouslySetInnerHTML={{ __html: logo.svg }}
		/>
	);
}

/** `logo` as an icon, for a place that takes one, such as a module's sidebar tab. */
export const brandIcon = (logo: BrandLogo): IconComponent =>
	function BrandIcon({ size, className }) {
		return <BrandMark logo={logo} size={size} className={className} />;
	};

// svgl (https://svgl.app) marks.
export const SLACK_LOGO: BrandLogo = { svg: '<svg enable-background="new 0 0 2447.6 2452.5" viewBox="0 0 2447.6 2452.5" xmlns="http://www.w3.org/2000/svg" ><g clip-rule="evenodd" fill-rule="evenodd"><path d="m897.4 0c-135.3.1-244.8 109.9-244.7 245.2-.1 135.3 109.5 245.1 244.8 245.2h244.8v-245.1c.1-135.3-109.5-245.1-244.9-245.3.1 0 .1 0 0 0m0 654h-652.6c-135.3.1-244.9 109.9-244.8 245.2-.2 135.3 109.4 245.1 244.7 245.3h652.7c135.3-.1 244.9-109.9 244.8-245.2.1-135.4-109.5-245.2-244.8-245.3z" fill="#36c5f0" /><path d="m2447.6 899.2c.1-135.3-109.5-245.1-244.8-245.2-135.3.1-244.9 109.9-244.8 245.2v245.3h244.8c135.3-.1 244.9-109.9 244.8-245.3zm-652.7 0v-654c.1-135.2-109.4-245-244.7-245.2-135.3.1-244.9 109.9-244.8 245.2v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.3z" fill="#2eb67d" /><path d="m1550.1 2452.5c135.3-.1 244.9-109.9 244.8-245.2.1-135.3-109.5-245.1-244.8-245.2h-244.8v245.2c-.1 135.2 109.5 245 244.8 245.2zm0-654.1h652.7c135.3-.1 244.9-109.9 244.8-245.2.2-135.3-109.4-245.1-244.7-245.3h-652.7c-135.3.1-244.9 109.9-244.8 245.2-.1 135.4 109.4 245.2 244.7 245.3z" fill="#ecb22e" /><path d="m0 1553.2c-.1 135.3 109.5 245.1 244.8 245.2 135.3-.1 244.9-109.9 244.8-245.2v-245.2h-244.8c-135.3.1-244.9 109.9-244.8 245.2zm652.7 0v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.2v-653.9c.2-135.3-109.4-245.1-244.7-245.3-135.4 0-244.9 109.8-244.8 245.1 0 0 0 .1 0 0" fill="#e01e5a" /></g></svg>' };
