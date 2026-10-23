const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "4m ago", "in 2h", "3d ago". */
export function relativeTime(iso: string, now = Date.now()): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const diff = now - then;
	const future = diff < 0;
	const abs = Math.abs(diff);
	let text: string;
	if (abs < 45_000) return "just now";
	else if (abs < HOUR) text = `${Math.round(abs / MINUTE)}m`;
	else if (abs < DAY) text = `${Math.round(abs / HOUR)}h`;
	else if (abs < 30 * DAY) text = `${Math.round(abs / DAY)}d`;
	else if (abs < 365 * DAY) text = `${Math.round(abs / (30 * DAY))}mo`;
	else text = `${Math.round(abs / (365 * DAY))}y`;
	return future ? `in ${text}` : `${text} ago`;
}

/** Exact local timestamp for tooltips. */
export function exactTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

/** "6d 23h" style remaining time; empty when already expired. */
export function remaining(iso: string, now = Date.now()): string {
	const until = Date.parse(iso);
	if (Number.isNaN(until)) return "";
	const diff = until - now;
	if (diff <= 0) return "";
	const days = Math.floor(diff / DAY);
	const hours = Math.floor((diff % DAY) / HOUR);
	const minutes = Math.floor((diff % HOUR) / MINUTE);
	const seconds = Math.floor((diff % MINUTE) / 1000);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function expiresIn(iso: string, now = Date.now()): string {
	const left = remaining(iso, now);
	return left ? `expires in ${left}` : "expired";
}

export function isExpired(iso: string, now = Date.now()): boolean {
	const until = Date.parse(iso);
	return !Number.isNaN(until) && until <= now;
}

/** Minute-granularity clock that components can bind to for live countdowns. */
export function startClock(intervalMs = 30_000, onTick: (now: number) => void): () => void {
	const id = window.setInterval(() => onTick(Date.now()), intervalMs);
	return () => window.clearInterval(id);
}
