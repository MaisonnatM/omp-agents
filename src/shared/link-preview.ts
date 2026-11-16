/** What a web page says about itself in its `<head>`: its Open Graph tags, else its `<title>` and description. */
export interface LinkPreview {
	title: string;
	description: string | null;
	/** The site's own name, such as `GitHub`, which the card shows instead of the bare host. */
	site: string | null;
}
