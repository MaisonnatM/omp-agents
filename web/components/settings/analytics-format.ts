export const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const full = new Intl.NumberFormat("en-US");
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const smallCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

export const dollars = (value: number): string => value > 0 && value < 0.0001 ? "<$0.0001" : (value > 0 && value < 0.01 ? smallCurrency : currency).format(value);
