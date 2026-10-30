/** Number, percent, and dollar formatters for the Settings analytics tab, its provider trends, and a Bot's Usage. */

export const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const full = new Intl.NumberFormat("en-US");
export const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const smallCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export const dollars = (value: number): string => value > 0 && value < 0.0001 ? "<$0.0001" : (value > 0 && value < 0.01 ? smallCurrency : currency).format(value);
