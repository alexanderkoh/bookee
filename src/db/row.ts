/* oxlint-disable typescript/no-explicit-any */

/**
 * A raw SQLite result row.
 *
 * Rows genuinely are dynamically typed: the driver returns whatever the query
 * selected, and only the mapper knows the shape. Declaring that once here —
 * rather than sprinkling `any` through the repositories — keeps the escape
 * hatch to a single, documented place. Everything that leaves a repository is
 * a typed domain object.
 */
export type SqlRow = Record<string, any>;
