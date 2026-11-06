declare const BOT_ID: unique symbol;

/** A Bot's id, which the page picks when it creates one, so a save sent twice saves once. Session starts name one, and the Bot model parses a skill from the session module, so the id cannot live there. */
export type BotId = string & { readonly [BOT_ID]: true };
