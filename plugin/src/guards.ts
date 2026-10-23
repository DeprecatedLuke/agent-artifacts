/**
 * Runtime shape checks for JSON that crosses the network boundary.
 *
 * One canonical guard module for this package: handlers in `api.ts` parse
 * responses through these instead of asserting shapes inline.
 */

/** JSON object (not null, not array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ReportSummary {
	project: string;
	slug: string;
	title: string;
	description: string;
	rev: number;
	created_at: string;
	updated_at: string;
	size: number;
}

export interface ProjectSummary {
	project: string;
	count: number;
	updated_at: string;
}

export interface ValidationProblem {
	line?: number;
	message: string;
}

export interface UploadedAsset {
	name: string;
	content_type: string;
	size: number;
	sha256: string;
	src: string;
}

export function isReportSummary(value: unknown): value is ReportSummary {
	return (
		isRecord(value) &&
		typeof value.project === "string" &&
		typeof value.slug === "string" &&
		typeof value.title === "string" &&
		typeof value.rev === "number"
	);
}

export function isProjectSummary(value: unknown): value is ProjectSummary {
	return isRecord(value) && typeof value.project === "string" && typeof value.count === "number";
}

export function isUploadedAsset(value: unknown): value is UploadedAsset {
	return isRecord(value) && typeof value.name === "string" && typeof value.content_type === "string";
}

/** Entries of `body[key]` that satisfy `guard`; `[]` for a missing or non-array field. */
export function readArray<T>(body: unknown, key: string, guard: (value: unknown) => value is T): T[] {
	if (!isRecord(body)) return [];
	const value = body[key];
	return Array.isArray(value) ? value.filter(guard) : [];
}

/** Parse `{error:"validation", problems:[...]}` into model-facing problems. */
export function readValidationProblems(body: unknown): ValidationProblem[] {
	if (!isRecord(body)) return [];
	const problems = body.problems;
	if (!Array.isArray(problems)) return [];
	const parsed: ValidationProblem[] = [];
	for (const problem of problems) {
		if (!isRecord(problem) || typeof problem.message !== "string" || problem.message === "") continue;
		parsed.push({
			line: typeof problem.line === "number" ? problem.line : undefined,
			message: problem.message,
		});
	}
	return parsed;
}

/** The `error` string of a JSON error body, when present. */
export function readErrorField(body: unknown): string | undefined {
	if (!isRecord(body)) return undefined;
	const value = body.error;
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** Validated `report_upload` tool arguments (model-authored JSON). */
export interface UploadParams {
	project: string;
	slug: string;
	path: string;
	name?: string;
}

/** Parse `report_upload` args; throws a model-facing error naming the missing field. */
export function readUploadParams(value: unknown): UploadParams {
	if (!isRecord(value)) throw new Error("report_upload requires an object with project, slug, and path");
	const project = typeof value.project === "string" ? value.project.trim() : "";
	const slug = typeof value.slug === "string" ? value.slug.trim() : "";
	const localPath = typeof value.path === "string" ? value.path.trim() : "";
	if (project === "") throw new Error("report_upload requires `project`");
	if (slug === "") throw new Error("report_upload requires `slug`");
	if (localPath === "") throw new Error("report_upload requires `path`");
	const name = typeof value.name === "string" && value.name.trim() !== "" ? value.name.trim() : undefined;
	return { project, slug, path: localPath, name };
}
