// Custom build (pulse): typed reads of SQLite row columns, so mappers need no casts.
import type { SqliteRow } from '../../sqlite/sqlite-statement'

export function text(row: SqliteRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new TypeError(`pulse: column ${column} is not text`)
  }
  return value
}

export function optionalText(row: SqliteRow, column: string): string | null {
  const value = row[column]
  return typeof value === 'string' ? value : null
}

export function integer(row: SqliteRow, column: string): number {
  const value = row[column]
  if (typeof value !== 'number') {
    throw new TypeError(`pulse: column ${column} is not an integer`)
  }
  return value
}

export function optionalInteger(row: SqliteRow, column: string): number | null {
  const value = row[column]
  return typeof value === 'number' ? value : null
}

/** A text column constrained by a CHECK to one of `allowed`. */
export function oneOf<T extends string>(row: SqliteRow, column: string, allowed: readonly T[]): T {
  const value = text(row, column)
  const match = allowed.find((candidate) => candidate === value)
  if (match === undefined) {
    throw new TypeError(`pulse: column ${column} has unexpected value ${value}`)
  }
  return match
}

export function optionalOneOf<T extends string>(
  row: SqliteRow,
  column: string,
  allowed: readonly T[]
): T | null {
  return row[column] === null || row[column] === undefined ? null : oneOf(row, column, allowed)
}
