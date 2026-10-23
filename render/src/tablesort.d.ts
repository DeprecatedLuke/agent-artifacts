/** `tablesort` ships no types; this declares the surface the report runtime uses. */
declare module "tablesort" {
	interface TablesortOptions {
		/** Sort descending on the first click. */
		descending?: boolean;
		/** Cell attribute that overrides its sort value (default `data-sort`). */
		sortAttribute?: string;
	}

	export default class Tablesort {
		constructor(table: HTMLTableElement, options?: TablesortOptions);
		refresh(): void;
		static extend(name: string, pattern: (item: string) => boolean, sort: (a: string, b: string) => number): void;
	}
}

/** The bundled sort extensions are plain scripts that register on the global. */
declare module "tablesort/src/sorts/*" {}
