/** Clipboard write with a fallback for non-secure origins. */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const area = document.createElement("textarea");
			area.value = text;
			area.setAttribute("readonly", "");
			area.style.position = "fixed";
			area.style.top = "-1000px";
			area.style.opacity = "0";
			document.body.appendChild(area);
			area.select();
			const ok = document.execCommand("copy");
			area.remove();
			return ok;
		} catch {
			return false;
		}
	}
}
