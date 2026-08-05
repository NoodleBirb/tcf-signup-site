/** Pure HubSpot field/value helpers (unit-tested, no API calls). */

import { getSmsConsentConfig } from '@/lib/hubspot/config'

export function mapSmsConsentToHubSpot(value: string) {
  const normalized = value.trim().toLowerCase()
  const { yesValue, noValue } = getSmsConsentConfig()
  if (normalized === 'yes') {
    return yesValue
  }
  if (normalized === 'no') {
    return noValue
  }
  return value.trim()
}

export function isDuplicateAssociationResponse(parsed: unknown, status: number) {
  if (status === 409) return true
  const text = JSON.stringify(parsed ?? '').toLowerCase()
  return (
    text.includes('already') &&
    (text.includes('associat') || text.includes('exist') || text.includes('duplicate'))
  )
}

export type TrainingAssociationRow = {
  trainingId: string
  associationType?: string
  associationCategory?: string
  associationTypeId?: number
}

function readAssociationTypeId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Normalize HubSpot v3 or v4 association list responses. */
export function parseTrainingAssociationRows(results: unknown): TrainingAssociationRow[] {
  if (!Array.isArray(results)) return []

  const rows: TrainingAssociationRow[] = []

  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>

    if (row.toObjectId !== undefined && Array.isArray(row.associationTypes)) {
      for (const associationType of row.associationTypes) {
        if (!associationType || typeof associationType !== 'object') continue
        const typed = associationType as Record<string, unknown>
        rows.push({
          trainingId: String(row.toObjectId),
          associationType:
            (typeof typed.label === 'string' && typed.label) ||
            (typed.typeId !== undefined ? String(typed.typeId) : undefined),
          associationCategory:
            typeof typed.category === 'string' ? typed.category : undefined,
          associationTypeId: readAssociationTypeId(typed.typeId),
        })
      }
      continue
    }

    if (row.id !== undefined) {
      rows.push({
        trainingId: String(row.id),
        associationType: row.type !== undefined ? String(row.type) : undefined,
      })
    }
  }

  return rows
}

export function matchesAssociationLabel(
  row: TrainingAssociationRow,
  label: string,
  configuredTypeId?: string
): boolean {
  const normalizedLabel = label.trim().toLowerCase()
  const rowType = (row.associationType ?? '').trim().toLowerCase()

  if (rowType && rowType === normalizedLabel) return true

  if (configuredTypeId && row.associationTypeId !== undefined) {
    return String(row.associationTypeId) === configuredTypeId.trim()
  }

  return false
}

const GENERIC_ASSOCIATION_TYPES = new Set([
  'contact_to_training',
  'contact_to_custom_object',
])

/** True when the row carries a labeled association that is not the registrant label. */
export function hasExplicitNonRegistrantLabel(
  row: TrainingAssociationRow,
  registrantLabel: string,
  registrantTypeId?: string
): boolean {
  if (matchesAssociationLabel(row, registrantLabel, registrantTypeId)) return false

  if (row.associationCategory === 'USER_DEFINED') return true
  if (row.associationTypeId !== undefined) return true

  const type = (row.associationType ?? '').trim().toLowerCase()
  if (!type) return false

  return !GENERIC_ASSOCIATION_TYPES.has(type)
}

export function hasActiveRegistrantAssociation(
  rows: TrainingAssociationRow[],
  trainingId: string,
  registrantLabel: string,
  registrantTypeId?: string
): boolean {
  return rows.some(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, registrantLabel, registrantTypeId)
  )
}

export function findTrainingIdsWithActiveRegistrantAssociation(
  rows: TrainingAssociationRow[],
  registrantLabel: string,
  registrantTypeId?: string,
  cancelledLabel?: string,
  cancelledTypeId?: string
): string[] {
  const trainingIds = [...new Set(rows.map((row) => row.trainingId))]

  return trainingIds.filter(
    (trainingId) =>
      findRegistrantAssociationsForTraining(
        rows,
        trainingId,
        registrantLabel,
        registrantTypeId,
        cancelledLabel,
        cancelledTypeId
      ).length > 0
  )
}

/** Training IDs with an active registrant or waitlist association (not cancelled/unwaitlisted). */
export function findTrainingIdsWithActiveSignupAssociation(
  rows: TrainingAssociationRow[],
  registrantLabel: string,
  waitlistLabel: string,
  registrantTypeId?: string,
  waitlistTypeId?: string,
  cancelledLabel?: string,
  cancelledTypeId?: string
): string[] {
  const trainingIds = [...new Set(rows.map((row) => row.trainingId))]

  return trainingIds.filter((trainingId) => {
    const hasRegistrant =
      findRegistrantAssociationsForTraining(
        rows,
        trainingId,
        registrantLabel,
        registrantTypeId,
        cancelledLabel,
        cancelledTypeId
      ).length > 0
    if (hasRegistrant) return true

    return (
      findWaitlistAssociationsForTraining(rows, trainingId, waitlistLabel, waitlistTypeId)
        .length > 0
    )
  })
}

export function findNonRegistrantAssociationsForTraining(
  rows: TrainingAssociationRow[],
  trainingId: string,
  registrantLabel: string,
  registrantTypeId?: string
): TrainingAssociationRow[] {
  return rows.filter(
    (row) =>
      row.trainingId === String(trainingId) &&
      !matchesAssociationLabel(row, registrantLabel, registrantTypeId)
  )
}

export function contactHasTrainingAssociation(
  associations: Array<{ id?: string; type?: string }> | undefined,
  trainingId: string,
  associationType?: string
) {
  return (associations ?? []).some((row) => {
    if (String(row.id) !== String(trainingId)) return false
    if (associationType === undefined) return true
    return (row.type ?? '').trim() === associationType.trim()
  })
}

export function contactHasRegistrantAssociation(
  associations: Array<{ id?: string; type?: string }> | undefined,
  trainingId: string,
  registrantLabel: string
) {
  return contactHasTrainingAssociation(associations, trainingId, registrantLabel)
}

export function contactHasAssociationForTraining(
  rows: TrainingAssociationRow[],
  trainingId: string,
  label: string,
  configuredTypeId?: string
): boolean {
  return rows.some(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, label, configuredTypeId)
  )
}

export function findWaitlistAssociationsForTraining(
  rows: TrainingAssociationRow[],
  trainingId: string,
  waitlistLabel: string,
  waitlistTypeId?: string
): TrainingAssociationRow[] {
  return rows.filter(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, waitlistLabel, waitlistTypeId)
  )
}

export function findCancelledAssociationsForTraining(
  rows: TrainingAssociationRow[],
  trainingId: string,
  cancelledLabel: string,
  cancelledTypeId?: string
): TrainingAssociationRow[] {
  return rows.filter(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, cancelledLabel, cancelledTypeId)
  )
}

export function findUnwaitlistedAssociationsForTraining(
  rows: TrainingAssociationRow[],
  trainingId: string,
  unwaitlistedLabel: string,
  unwaitlistedTypeId?: string
): TrainingAssociationRow[] {
  return rows.filter(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, unwaitlistedLabel, unwaitlistedTypeId)
  )
}

export function findRegistrantAssociationsForTraining(
  rows: TrainingAssociationRow[],
  trainingId: string,
  registrantLabel: string,
  registrantTypeId?: string,
  cancelledLabel?: string,
  cancelledTypeId?: string
): TrainingAssociationRow[] {
  const isCancelled = (row: TrainingAssociationRow) =>
    cancelledLabel !== undefined &&
    matchesAssociationLabel(row, cancelledLabel, cancelledTypeId)

  const matches = rows.filter(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, registrantLabel, registrantTypeId)
  )

  if (matches.length > 0) return matches

  // Legacy unlabeled associations only — never treat waitlist/unregistered/etc. as registrant.
  const legacyCandidates = rows.filter(
    (row) =>
      row.trainingId === String(trainingId) &&
      !isCancelled(row) &&
      !hasExplicitNonRegistrantLabel(row, registrantLabel, registrantTypeId)
  )
  if (legacyCandidates.length === 1) return legacyCandidates

  return []
}

export function hasCancelledAssociation(
  rows: TrainingAssociationRow[],
  trainingId: string,
  cancelledLabel: string,
  cancelledTypeId?: string
): boolean {
  return rows.some(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, cancelledLabel, cancelledTypeId)
  )
}

export function hasUnwaitlistedAssociation(
  rows: TrainingAssociationRow[],
  trainingId: string,
  unwaitlistedLabel: string,
  unwaitlistedTypeId?: string
): boolean {
  return rows.some(
    (row) =>
      row.trainingId === String(trainingId) &&
      matchesAssociationLabel(row, unwaitlistedLabel, unwaitlistedTypeId)
  )
}
