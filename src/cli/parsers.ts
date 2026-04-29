import { InvalidArgumentError } from 'commander'

export function parseInteger(value: string): number {
  const parsed = Number(value)

  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError('Expected an integer')
  }

  return parsed
}

export function parsePositiveInteger(value: string): number {
  const parsed = parseInteger(value)

  if (parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer')
  }

  return parsed
}

export function parseLimit(value: string): number {
  const parsed = parsePositiveInteger(value)

  if (parsed > 50) {
    throw new InvalidArgumentError('Expected a value between 1 and 50')
  }

  return parsed
}

export function parseNumberOption(value: string): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError('Expected a finite number')
  }

  return parsed
}

export function parseTimeValidity(value: string): 'DAY' | 'GOOD_TILL_CANCEL' {
  if (value === 'DAY' || value === 'GOOD_TILL_CANCEL') {
    return value
  }

  throw new InvalidArgumentError('Expected DAY or GOOD_TILL_CANCEL')
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new InvalidArgumentError('Expected a JSON object')
    }

    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      throw error
    }

    throw new InvalidArgumentError('Expected valid JSON')
  }
}

export function parseIsoDate(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidArgumentError('Expected an ISO 8601 date-time string')
  }

  return value
}
