/**
 * HubSpot API utilities for contact creation and association.
 * Portal wiring lives in config/hubspot.json; only HUBSPOT_API_KEY stays in .env.
 */

import pagesJson from '../../../content/pages.json'
import { signupFormContent } from '@/lib/content'
import { alreadyRegisteredAnotherTrainingMessage } from '@/lib/signup/messages'
import type { PagesContent } from '@/lib/content/types'
import type { TrainingSchedule } from '@/lib/dates/format-schedule'
import { getTrainingCutoffPropertyKey, getTrainingSchedulePropertyKeys } from '@/lib/hubspot/config'
import {
  getCancelledAssociationTypeId,
  getContactPropertyKeys,
  getHubSpotApiKey,
  getRegistrantAssociationLabel,
  getRegistrantAssociationTypeId,
  getCancelledAssociationLabel,
  getSignupWorkflowFlagConfig,
  getSmsConsentConfig,
  getTrainingObjectId,
  getTrainingProperties,
  getUnwaitlistedAssociationLabel,
  getUnwaitlistedAssociationTypeId,
  getWaitlistAssociationLabel,
  getWaitlistAssociationTypeId,
} from '@/lib/hubspot/config'
import {
  contactHasAssociationForTraining,
  findNonRegistrantAssociationsForTraining,
  findRegistrantAssociationsForTraining,
  findTrainingIdsWithActiveSignupAssociation,
  findUnwaitlistedAssociationsForTraining,
  findWaitlistAssociationsForTraining,
  hasActiveRegistrantAssociation,
  hasCancelledAssociation,
  hasUnwaitlistedAssociation,
  isDuplicateAssociationResponse,
  mapSmsConsentToHubSpot,
  parseTrainingAssociationRows,
  type TrainingAssociationRow,
} from '@/lib/hubspot/field-mappers'
import {
  getProgramPipelineConfig,
  type TrainingProgramId,
} from '@/lib/programs/config'
import { doesTrainingBlockProgramSignup } from '@/lib/signup/active-registration'

export {
  getCancelledAssociationLabel,
  getRegistrantAssociationLabel,
} from '@/lib/hubspot/config'

const eventLabels = (pagesJson as PagesContent).events

const HUBSPOT_API_BASE = 'https://api.hubapi.com'

/** HubSpot must always be live; Next.js caches `fetch` in production by default. */
function hubspotFetch(url: string | URL, init?: RequestInit) {
  return fetch(url, { ...init, cache: 'no-store' })
}

export class AlreadyRegisteredError extends Error {
  constructor(message = 'You are already registered for this event.') {
    super(message)
    this.name = 'AlreadyRegisteredError'
  }
}

function getTrainingObjectType() {
  return getTrainingObjectId()
}

function getApiKey() {
  return getHubSpotApiKey()
}

export type TrainingAssociationRole = 'registrant' | 'waitlist'

export interface ContactData {
  firstName: string
  lastName: string
  email: string
  phone: string
  hometownCity: string
  hometownState: string
  currentYear: string
  isVirginiaResident: string
  trainingDates: string
  interestReason: string
  communitySupport: string
  smsConsent?: string
}

export interface HubSpotContact {
  id: string
  properties: {
    [key: string]: string
  }
}

export interface HubSpotCompany {
  id: string
  properties: {
    [key: string]: string
  }
}

export interface HubSpotOpportunity {
  id: string
  properties: {
    [key: string]: string
  }
}

export interface HubSpotTraining {
  id: string
  properties: {
    [key: string]: string
  }
}

export interface TrainingEvent {
  id: string
  title: string
  schedule: TrainingSchedule
  sortDate?: string
  location: string
  capacity: number
  registered: number
  availableCapacity: number
  availableWaitlistCapacity: number
  waitlistFull: boolean
  active: boolean
  description?: string
  hubspotPipelineStage?: string
  /** HubSpot datetime when registration closes; empty uses 48h-before-start default in app logic */
  cutoffTime?: string
}

function parseDateProperty(value?: string) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export { formatTrainingSchedule } from '@/lib/dates/format-schedule'

/**
 * Maps form data to HubSpot contact properties from config/hubspot.json
 */
function mapContactProperties(data: ContactData): { [key: string]: string } {
  const keys = getContactPropertyKeys()
  const properties: { [key: string]: string } = {
    [keys.firstName]: data.firstName,
    [keys.lastName]: data.lastName,
    [keys.email]: data.email,
    [keys.phone]: data.phone,
    [keys.hometownCity]: data.hometownCity,
    [keys.hometownState]: data.hometownState,
    [keys.currentYear]: data.currentYear,
    [keys.virginiaResident]: data.isVirginiaResident,
    [keys.interestReason]: data.interestReason,
    [keys.communitySupport]: data.communitySupport,
  }

  if (data.smsConsent) {
    properties[getSmsConsentConfig().property] = mapSmsConsentToHubSpot(data.smsConsent)
  }

  const signupFlag = getSignupWorkflowFlagConfig()
  if (signupFlag.property) {
    properties[signupFlag.property] = signupFlag.value
  }

  return properties
}

/**
 * Returns true if the contact is already linked to this training in HubSpot.
 */
export async function isContactRegisteredForTraining(
  contactId: string,
  trainingId: string
): Promise<boolean> {
  const associations = await getContactTrainingAssociations(contactId)
  return hasActiveRegistrantAssociation(
    associations,
    trainingId,
    getRegistrantAssociationLabel(),
    getRegistrantAssociationTypeId()
  )
}

/**
 * True when the contact has an active registrant or waitlist association on a different
 * training in the same program that has not yet ended (day 2 end if present, else day 1).
 */
export async function isContactRegisteredForAnotherTraining(
  contactId: string,
  trainingId: string,
  programId: TrainingProgramId
): Promise<boolean> {
  const associations = await getContactTrainingAssociations(contactId)
  return contactHasActiveSignupElsewhereInProgram(associations, trainingId, programId)
}

async function contactHasActiveSignupElsewhereInProgram(
  associations: TrainingAssociationRow[],
  trainingId: string,
  programId: TrainingProgramId
): Promise<boolean> {
  const candidateIds = findTrainingIdsWithActiveSignupAssociation(
    associations,
    getRegistrantAssociationLabel(),
    getWaitlistAssociationLabel(),
    getRegistrantAssociationTypeId(),
    getWaitlistAssociationTypeId(),
    getCancelledAssociationLabel(),
    getCancelledAssociationTypeId()
  ).filter((id) => id !== String(trainingId))

  if (candidateIds.length === 0) return false

  const { pipelineType } = getProgramPipelineConfig(programId)

  const blocking = await Promise.all(
    candidateIds.map(async (candidateId) => {
      const training = await getTrainingById(candidateId)
      if (!training) return false

      return doesTrainingBlockProgramSignup({
        trainingPipeline: training.properties.hs_pipeline,
        programPipelineType: pipelineType,
        schedule: mapTrainingToEvent(training).schedule,
      })
    })
  )

  return blocking.some(Boolean)
}

/** Returns true if the contact has a waitlist association to this training. */
export async function isContactOnWaitlistForTraining(
  contactId: string,
  trainingId: string
): Promise<boolean> {
  const associations = await getContactTrainingAssociations(contactId)
  return contactHasAssociationForTraining(
    associations,
    trainingId,
    getWaitlistAssociationLabel(),
    getWaitlistAssociationTypeId()
  )
}

export async function getContactTrainingAssociations(
  contactId: string
): Promise<TrainingAssociationRow[]> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const trainingObjectType = getTrainingObjectType()
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }

  const v4Url = `${HUBSPOT_API_BASE}/crm/v4/objects/contacts/${contactId}/associations/${trainingObjectType}`
  const v4Response = await hubspotFetch(v4Url, { method: 'GET', headers })

  if (v4Response.status !== 404) {
    const v4Parsed = await safeParseResponse(v4Response)
    if (v4Response.ok) {
      const rows = parseTrainingAssociationRows(v4Parsed?.results)
      if (rows.length > 0) return rows
    }
  }

  const v3Url = `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}/associations/${trainingObjectType}`
  const v3Response = await hubspotFetch(v3Url, { method: 'GET', headers })

  if (v3Response.status === 404) {
    return []
  }

  const v3Parsed = await safeParseResponse(v3Response)
  if (!v3Response.ok) {
    const msg =
      (v3Parsed && (v3Parsed.message || v3Parsed.error || v3Parsed.text)) ||
      v3Response.statusText
    throw new Error(`Failed to list training associations: ${msg}`)
  }

  return parseTrainingAssociationRows(v3Parsed?.results)
}

async function archiveContactTrainingAssociation(
  contactId: string,
  trainingId: string,
  row: TrainingAssociationRow
): Promise<void> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const trainingObjectType = getTrainingObjectType()
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }

  if (row.associationCategory && row.associationTypeId !== undefined) {
    // Labeled associations: use labels/archive (single `to` object + `types`).
    // Plain batch/archive expects `to` as an array and removes all labels between the pair.
    const v4Url = `${HUBSPOT_API_BASE}/crm/v4/associations/contacts/${trainingObjectType}/batch/labels/archive`
    const v4Response = await hubspotFetch(v4Url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: [
          {
            from: { id: contactId },
            to: { id: trainingId },
            types: [
              {
                associationCategory: row.associationCategory,
                associationTypeId: row.associationTypeId,
              },
            ],
          },
        ],
      }),
    })

    if (v4Response.status === 204 || v4Response.ok) {
      return
    }

    const v4Parsed = await safeParseResponse(v4Response)
    const msg =
      (v4Parsed && (v4Parsed.message || v4Parsed.error || v4Parsed.text)) ||
      v4Response.statusText
    throw new Error(`Failed to remove training association: ${msg}`)
  }

  const associationType = row.associationType ?? getRegistrantAssociationLabel()
  const v3Url = `${HUBSPOT_API_BASE}/crm/v3/associations/contacts/${trainingObjectType}/batch/archive`
  const v3Response = await hubspotFetch(v3Url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: [
        {
          from: { id: contactId },
          to: { id: trainingId },
          type: associationType,
        },
      ],
    }),
  })

  if (v3Response.status === 204 || v3Response.ok) {
    return
  }

  const v3Parsed = await safeParseResponse(v3Response)
  const msg =
    (v3Parsed && (v3Parsed.message || v3Parsed.error || v3Parsed.text)) ||
    v3Response.statusText
  throw new Error(`Failed to remove training association: ${msg}`)
}

async function createContactTrainingAssociation(
  contactId: string,
  trainingId: string,
  label: string,
  typeId?: string
): Promise<void> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const trainingObjectType = getTrainingObjectType()
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }

  if (typeId) {
    const v4Url = `${HUBSPOT_API_BASE}/crm/v4/associations/contacts/${trainingObjectType}/batch/create`
    const v4Response = await hubspotFetch(v4Url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        inputs: [
          {
            from: { id: contactId },
            to: { id: trainingId },
            types: [
              {
                associationCategory: 'USER_DEFINED',
                associationTypeId: Number.parseInt(typeId, 10),
              },
            ],
          },
        ],
      }),
    })

    const v4Parsed = await safeParseResponse(v4Response)
    if (v4Response.ok) return

    if (!isDuplicateAssociationResponse(v4Parsed, v4Response.status)) {
      const msg =
        (v4Parsed && (v4Parsed.message || v4Parsed.error || v4Parsed.text)) ||
        v4Response.statusText
      throw new Error(`Failed to create training association: ${msg}`)
    }
    return
  }

  const v3Url = `${HUBSPOT_API_BASE}/crm/v3/associations/contacts/${trainingObjectType}/batch/create`
  const v3Response = await hubspotFetch(v3Url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: [
        {
          from: { id: contactId },
          to: { id: trainingId },
          type: label,
        },
      ],
    }),
  })

  const v3Parsed = await safeParseResponse(v3Response)
  if (!v3Response.ok) {
    if (isDuplicateAssociationResponse(v3Parsed, v3Response.status)) return
    const msg =
      (v3Parsed && (v3Parsed.message || v3Parsed.error || v3Parsed.text)) ||
      v3Response.statusText
    throw new Error(`Failed to create training association: ${msg}`)
  }
}

/**
 * Unregister a contact from a training.
 * - mode `remove`: archive the registrant association only.
 * - mode `relabel`: archive registrant, then associate with cancelled label (audit trail).
 * Idempotent when already cancelled.
 */
export async function unregisterContactFromTraining(
  contactId: string,
  trainingId: string,
  mode: 'remove' | 'relabel' = 'remove'
): Promise<{ alreadyCancelled: boolean }> {
  const registrantLabel = getRegistrantAssociationLabel()
  const cancelledLabel = getCancelledAssociationLabel()
  const associations = await getContactTrainingAssociations(contactId)

  if (
    hasCancelledAssociation(
      associations,
      trainingId,
      cancelledLabel,
      getCancelledAssociationTypeId()
    )
  ) {
    return { alreadyCancelled: true }
  }

  const registrantRows = findRegistrantAssociationsForTraining(
    associations,
    trainingId,
    registrantLabel,
    getRegistrantAssociationTypeId(),
    cancelledLabel,
    getCancelledAssociationTypeId()
  )

  if (registrantRows.length === 0) {
    throw new Error('Contact is not registered for this training')
  }

  for (const row of registrantRows) {
    await archiveContactTrainingAssociation(contactId, trainingId, row)
  }

  if (mode === 'relabel') {
    try {
      await createContactTrainingAssociation(
        contactId,
        trainingId,
        cancelledLabel,
        getCancelledAssociationTypeId()
      )
    } catch (error: unknown) {
      console.error('Cancelled association label create failed:', error)
      throw new Error(
        `Registration removed, but could not apply cancelled label "${cancelledLabel}". Check HUBSPOT_TRAINING_CANCELLED_ASSOCIATION_LABEL in HubSpot.`
      )
    }
  }

  return { alreadyCancelled: false }
}

/**
 * Remove a contact from a training waitlist.
 * - mode `remove`: archive the waitlist association only.
 * - mode `relabel`: archive waitlist, then associate with unwaitlisted label (audit trail).
 * Idempotent when already unwaitlisted.
 */
export async function unwaitlistContactFromTraining(
  contactId: string,
  trainingId: string,
  mode: 'remove' | 'relabel' = 'remove'
): Promise<{ alreadyLeft: boolean }> {
  const waitlistLabel = getWaitlistAssociationLabel()
  const unwaitlistedLabel = getUnwaitlistedAssociationLabel()
  const associations = await getContactTrainingAssociations(contactId)

  if (
    hasUnwaitlistedAssociation(
      associations,
      trainingId,
      unwaitlistedLabel,
      getUnwaitlistedAssociationTypeId()
    )
  ) {
    return { alreadyLeft: true }
  }

  const waitlistRows = findWaitlistAssociationsForTraining(
    associations,
    trainingId,
    waitlistLabel,
    getWaitlistAssociationTypeId()
  )

  if (waitlistRows.length === 0) {
    throw new Error('Contact is not on the waitlist for this training')
  }

  for (const row of waitlistRows) {
    await archiveContactTrainingAssociation(contactId, trainingId, row)
  }

  if (mode === 'relabel') {
    try {
      await createContactTrainingAssociation(
        contactId,
        trainingId,
        unwaitlistedLabel,
        getUnwaitlistedAssociationTypeId()
      )
    } catch (error: unknown) {
      console.error('Unwaitlisted association label create failed:', error)
      throw new Error(
        `Waitlist spot removed, but could not apply unwaitlisted label "${unwaitlistedLabel}". Check HubSpot association settings.`
      )
    }
  }

  return { alreadyLeft: false }
}

export async function getTrainingById(trainingId: string): Promise<HubSpotTraining | null> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const objectType = getTrainingObjectType()
  const properties = getTrainingProperties()

  const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}/${trainingId}`)
  url.searchParams.set('properties', properties.join(','))

  const response = await hubspotFetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 404) {
    return null
  }

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    throw new Error(`Failed to fetch training: ${msg}`)
  }

  return parsed ?? null
}

async function safeParseResponse(res: Response): Promise<any> {
  // Read text and attempt JSON.parse; return null for empty bodies
  let text = ''
  try {
    text = await res.text()
  } catch (e) {
    return null
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (e) {
    return { text }
  }
}

/**
 * Create or update a contact in HubSpot by email
 * @param data Form submission data
 * @returns HubSpot contact with ID
 */
export async function createOrUpdateContact(data: ContactData): Promise<HubSpotContact> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const properties = mapContactProperties(data)
  const existing = await getContactByEmail(data.email)

  if (existing?.id) {
    const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${existing.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties,
      }),
    })

    if (!response.ok) {
      const error = await safeParseResponse(response)
      const msg = (error && (error.message || error.error || error.text)) || response.statusText
      throw new Error(`HubSpot API error: ${msg}`)
    }

    const parsed = await safeParseResponse(response)
    return parsed ?? { id: existing.id }
  }

  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties,
    }),
  })

  if (!response.ok) {
    const error = await safeParseResponse(response)
    const msg = (error && (error.message || error.error || error.text)) || response.statusText
    throw new Error(`HubSpot API error: ${msg}`)
  }

  const parsed = await safeParseResponse(response)
  return parsed
}

/**
 * Get or create a company by website domain.
 * If a company with the given website already exists, return it.
 * Otherwise, create a new company and return it.
 * @param website The website URL (e.g., 'virginia.edu')
 * @returns HubSpot company with ID
 */
export async function getOrCreateCompanyByWebsite(website: string): Promise<HubSpotCompany> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  // Search for an existing company by website domain
  const searchUrl = `${HUBSPOT_API_BASE}/crm/v3/objects/companies/search`
  const searchResponse = await hubspotFetch(searchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'domain',
              operator: 'EQ',
              value: website,
            },
          ],
        },
      ],
      properties: ['name'],
      limit: 1,
    }),
  })

  if (searchResponse.ok) {
    const searchData = await safeParseResponse(searchResponse)
    if (searchData?.results?.[0]) {
      console.debug('Found existing company by domain:', { website, id: searchData.results[0].id })
      return searchData.results[0]
    }
  }

  // No existing company found; create a new one
  const createUrl = `${HUBSPOT_API_BASE}/crm/v3/objects/companies`
  const createResponse = await hubspotFetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        name: website,
        domain: website,
      },
    }),
  })

  if (!createResponse.ok) {
    const error = await safeParseResponse(createResponse)
    const msg = (error && (error.message || error.error || error.text)) || createResponse.statusText
    throw new Error(`Failed to create company: ${msg}`)
  }

  const created = await safeParseResponse(createResponse)
  console.debug('Created new company:', { website, id: created?.id })
  return created
}

/**
 * Associate a contact with a company
 * @param contactId HubSpot contact ID
 * @param companyId HubSpot company ID
 */
export async function associateContactToCompany(contactId: string, companyId: string): Promise<void> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const url = `${HUBSPOT_API_BASE}/crm/v3/associations/contacts/companies/batch/create`
  const response = await hubspotFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [
        {
          from: { id: contactId },
          to: { id: companyId },
          "type": "contact_to_company"
        },
      ],
    }),
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    console.error('Association error response:', parsed)
    let msg = (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    if (typeof msg === 'string' && msg.trim().startsWith('<')) {
      msg = `Non-JSON response (status ${response.status})`
    }
    throw new Error(`Failed to associate contact to company: ${msg}`)
  }

  console.debug('Associated contact to company:', { contactId, companyId, parsed })
}

/**
 * Associate a contact with a training event
 * @param contactId HubSpot contact ID
 * @param trainingId Training event ID (e.g., from eventId in form data)
 */
export async function associateContactToTraining(
  contactId: string,
  trainingId: string,
  role: TrainingAssociationRole = 'registrant',
  programId: TrainingProgramId
): Promise<void> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  if (await isContactRegisteredForTraining(contactId, trainingId)) {
    throw new AlreadyRegisteredError()
  }

  if (role === 'waitlist' && (await isContactOnWaitlistForTraining(contactId, trainingId))) {
    throw new AlreadyRegisteredError('You are already on the waitlist for this event.')
  }

  const associations = await getContactTrainingAssociations(contactId)

  if (await contactHasActiveSignupElsewhereInProgram(associations, trainingId, programId)) {
    throw new AlreadyRegisteredError(
      alreadyRegisteredAnotherTrainingMessage(signupFormContent.messages)
    )
  }

  if (role === 'registrant') {
    const replaceableRows = findNonRegistrantAssociationsForTraining(
      associations,
      trainingId,
      getRegistrantAssociationLabel(),
      getRegistrantAssociationTypeId()
    )
    for (const row of replaceableRows) {
      await archiveContactTrainingAssociation(contactId, trainingId, row)
    }
  }

  if (role === 'waitlist') {
    const unwaitlistedRows = findUnwaitlistedAssociationsForTraining(
      associations,
      trainingId,
      getUnwaitlistedAssociationLabel(),
      getUnwaitlistedAssociationTypeId()
    )
    for (const row of unwaitlistedRows) {
      await archiveContactTrainingAssociation(contactId, trainingId, row)
    }
  }

  const trainingObjectType = getTrainingObjectType()

  // Use the batch associations endpoint which is the supported pattern
  // for creating associations between two object types.
  const url = `${HUBSPOT_API_BASE}/crm/v3/associations/contacts/${trainingObjectType}/batch/create`
  const associationLabel =
    role === 'waitlist' ? getWaitlistAssociationLabel() : getRegistrantAssociationLabel()
  const response = await hubspotFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [
        {
          from: { id: contactId },
          to: { id: trainingId },
          type: associationLabel,
        },
      ],
    }),
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    console.error('Association error response:', parsed)
    if (isDuplicateAssociationResponse(parsed, response.status)) {
      throw new AlreadyRegisteredError(
        role === 'waitlist'
          ? 'You are already on the waitlist for this event.'
          : undefined
      )
    }
    let msg = (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    // Hide large HTML error bodies and give a concise message instead
    if (typeof msg === 'string' && msg.trim().startsWith('<')) {
      msg = `Non-JSON response (status ${response.status})`
    }
    throw new Error(`Failed to associate contact with training: ${msg}`)
  }

  console.debug('Associated contact to training:', { contactId, trainingId, trainingObjectType, parsed })
}

/**
 * Get an existing contact by email
 * @param email Contact email
 * @returns HubSpot contact or null if not found
 */
export async function getContactByEmail(email: string): Promise<HubSpotContact | null> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'email',
              operator: 'EQ',
              value: email,
            },
          ],
        },
      ],
      properties: (() => {
        const keys = getContactPropertyKeys()
        return [keys.email, keys.firstName, keys.lastName, keys.phone]
      })(),
      limit: 1,
    }),
  })

  if (!response.ok) {
    const error = await safeParseResponse(response)
    const msg = (error && (error.message || error.error || error.text)) || response.statusText
    throw new Error(`HubSpot API error: ${msg}`)
  }

  const data = await safeParseResponse(response)
  return data?.results?.[0] ?? null
}

/**
 * Fetch training objects from HubSpot filtered by pipeline stage.
 * The stage is matched against the custom object property `hs_pipeline`.
 *
 * @param pipelineStage Open-for-registration stage (`hs_pipeline_stage`)
 * @param pipelineType Pipeline filter (`hs_pipeline`)
 * @param closedPipelineStage Optional closed stage; listed on site but not open for signup
 * @returns Array of training objects from HubSpot
 */
export async function getTrainingObjects(
  pipelineStage?: string,
  pipelineType?: string,
  closedPipelineStage?: string
): Promise<HubSpotTraining[]> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const limit = 100
  let allResults: HubSpotTraining[] = []
  let after: string | null = null
  const requestedProperties = getTrainingProperties()

  try {
    const objectType = getTrainingObjectType()

    do {
      const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}`)
      url.searchParams.set('limit', limit.toString())
      url.searchParams.set('properties', requestedProperties.join(','))
      if (after) url.searchParams.set('after', after)

      const response = await hubspotFetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        let bodyText = ''
        try {
          bodyText = await response.text()
        } catch {
          bodyText = response.statusText
        }
        throw new Error(`HubSpot API error: ${response.status} ${bodyText}`)
      }

      const data = await response.json()
      allResults = allResults.concat(data.results || [])
      after = data.paging?.next?.after || null
    } while (after)

    // console.log(allResults)

    console.debug('[hubspotApi] raw training objects fetched', {
      objectType,
      pipelineStage,
      closedPipelineStage,
      pipelineType,
      requestedProperties,
      count: allResults.length,
      sampleProperties: allResults[0]?.properties ? Object.keys(allResults[0].properties).slice(0, 20) : [],
      sampleHsPipeline: allResults[0]?.properties?.hs_pipeline,
    })

    if (pipelineType) {
        const targetStage = pipelineType.trim()
        allResults = allResults.filter((training) => {
            const stage = (training.properties?.hs_pipeline ?? '').trim()
            //console.debug('[hubspotApi] comparing pipeline stage', { trainingId: training.id, stage, targetStage })
            return stage === targetStage
        })
    }
    const allowedPipelineStages = [pipelineStage, closedPipelineStage]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
    if (allowedPipelineStages.length > 0) {
      allResults = allResults.filter((training) => {
        const stage = (training.properties?.hs_pipeline_stage ?? '').trim()
        return allowedPipelineStages.includes(stage)
      })
    }

    return allResults
  } catch (error: any) {
    console.error('Error fetching training objects:', error)
    throw error
  }
}

  /**
   * Convert HubSpot training object to app TrainingEvent format
   */
function readTrainingProperty(
  props: HubSpotTraining['properties'],
  ...keys: string[]
) {
  for (const key of keys) {
    const value = props[key]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

export function mapTrainingToEvent(training: HubSpotTraining): TrainingEvent {
  const props = training.properties
  const capacity = parseInt(
    readTrainingProperty(props, 'hs_enrollment_capacity', 'capacity') || '0',
    10
  )
  const availableCapacity = parseInt(props.available_capacity || '0', 10)
  const availableWaitlistCapacity = parseInt(props.available_waitlist_capacity || '0', 10)
  const waitlistFull = availableWaitlistCapacity <= 0
  const scheduleKeys = getTrainingSchedulePropertyKeys()
  const cutoffKey = getTrainingCutoffPropertyKey()
  const schedule: TrainingSchedule = {
    session1Start: readTrainingProperty(props, scheduleKeys.session1Start),
    session1End: readTrainingProperty(props, scheduleKeys.session1End),
    session2Start: readTrainingProperty(props, scheduleKeys.session2Start),
    session2End: readTrainingProperty(props, scheduleKeys.session2End),
  }
  const parsedStartDate = parseDateProperty(schedule.session1Start)

  return {
    id: training.id,
    title: readTrainingProperty(props, 'hs_course_name', 'name') || eventLabels.untitledEvent,
    schedule,
    sortDate: parsedStartDate?.toISOString() || schedule.session1Start,
    location: readTrainingProperty(props, 'location') || eventLabels.defaultLocation,
    capacity,
    registered: Math.max(0, capacity - availableCapacity),
    availableCapacity,
    availableWaitlistCapacity,
    waitlistFull,
    active: true,
    description: props.description,
    hubspotPipelineStage: props.hs_pipeline_stage,
    cutoffTime: readTrainingProperty(props, cutoffKey),
  }
}

/**
 * Associate a contact with an opportunity using the label Saved.
 * @param contactId HubSpot contact ID
 * @param opportunityId HubSpot deal ID
 */
export async function associateContactToOpportunity(
  contactId: string,
  opportunityId: string,
  associationCategory: string,
  associationTypeId: number
): Promise<void> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const opportunityObjectType = '0-420'
  const url = `${HUBSPOT_API_BASE}/crm/v4/associations/contacts/${opportunityObjectType}/batch/create`
  const response = await hubspotFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [
        {
          from: { id: contactId },
          to: { id: opportunityId },
          types: [
            {
              associationCategory,
              associationTypeId
            }
          ]
        }
      ]
    })
  });

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    throw new Error(`Failed to associate contact with opportunity: ${response.statusText}`)
  }

  console.debug('Associated contact to opportunity:', {
    contactId,
    opportunityId,
    parsed,
  })
}

/**
 * Disassociate a contact from an opportunity (remove the Saved label).
 * @param contactId HubSpot contact ID
 * @param opportunityId HubSpot deal ID
 */
export async function disassociateContactFromOpportunity(
  contactId: string,
  opportunityId: string,
  associationCategory: string,
  associationTypeId: number
): Promise<void> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const opportunityObjectType = '0-420'
  const url = `${HUBSPOT_API_BASE}/crm/v4/associations/contacts/${opportunityObjectType}/batch/labels/archive`
  const response = await hubspotFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [
        {
          from: { id: contactId },
          to: { id: opportunityId },
          types: [
            {
              associationCategory,
              associationTypeId
            },
          ],
        },
      ],
    }),
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    throw new Error(`Failed to disassociate contact from opportunity: ${response.statusText}`)
  }

  console.debug('Disassociated contact from opportunity:', {
    contactId,
    opportunityId,
    parsed,
  })
}

export async function updateContactProperties(
  contactId: string, 
  properties: Record<string, string>
): Promise<HubSpotContact> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })

  if (!response.ok) {
    const error = await safeParseResponse(response)
    const msg = (error && (error.message || error.error || error.text)) || response.statusText
    throw new Error(`HubSpot API error: ${msg}`)
  }

  const parsed = await safeParseResponse(response)
  return parsed;
}

/**
 * Update a company with the provided properties.
 * 
 * @param companyId HubSpot company ID
 * @param properties Object with property names as keys and string values
 * @returns Updated company object
 */
export async function updateCompanyProperties(
  companyId: string,
  properties: Record<string, string>
): Promise<HubSpotCompany> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v3/objects/companies/${companyId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })

  if (!response.ok) {
    const error = await safeParseResponse(response)
    const msg = (error && (error.message || error.error || error.text)) || response.statusText
    throw new Error(`HubSpot API error: ${msg}`)
  }

  const parsed = await safeParseResponse(response)
  return parsed
}


/**
 * Fetch a specific property from a contact by ID
 * @param contactId HubSpot contact ID
 * @param property Property name to fetch
 * @returns Property value or null if not found
 */
export async function getContactProperty(contactId: string, property: string): Promise<string | null> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}`)
  url.searchParams.set('properties', property)

  const response = await hubspotFetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 404) {
    return null
  }

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    throw new Error(`Failed to fetch contact property: ${msg}`)
  }

  return parsed?.properties?.[property] ?? null
}

/**
 * Upload a file to HubSpot File Manager and return the resulting URL.
 */
export async function uploadFileToHubSpot(
  formData: FormData
): Promise<string> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const url = `${HUBSPOT_API_BASE}/files/v3/files`
  const response = await hubspotFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: formData,
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    throw new Error(`Failed to upload file to HubSpot: ${msg}`)
  }

  const uploaded = Array.isArray(parsed?.objects)
    ? parsed.objects[0]
    : parsed
  const fileUrl = uploaded?.url;

  if (!fileUrl || typeof fileUrl !== 'string') {
    throw new Error('HubSpot file upload succeeded but did not return a file URL')
  }

  console.debug('Uploaded file to HubSpot:', { fileUrl });
  return fileUrl
}

export async function getApplicantsForOpportunities(
  opportunityIds: string[],
  associationTypeIds: number[] = [22, 24, 46, 6, 8]
): Promise<object[]> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const targetIds = new Set(associationTypeIds.map((value) => String(value)))
  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }

  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v4/associations/0-420/contacts/batch/read`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: opportunityIds.map(id => ({ id })),
    }),
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    const msg = (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    throw new Error(`Failed to list opportunity associations: ${msg}`)
  }

  const debug = [];

  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  debug.push('getApplicantsForOpportunities batch read response:', { results, targetIds: Array.from(targetIds) })
  const applicantsByOpportunity = new Map<string, object[]>()

  for (const oppId of opportunityIds) {
    const matchingContactIds = new Map<string, string | undefined>()

    for (const entry of results) {
      const fromId = (entry as { from?: { id?: string } })?.from?.id
      debug.push(`Checking entry from ${fromId} against oppId ${oppId}`)
      if (fromId !== oppId) continue

      const toArray = ((entry as { to?: Array<Record<string, unknown>> }).to ?? []) as Array<Record<string, unknown>>
      debug.push(`Found matching opportunity ${oppId}, processing ${toArray.length} associations`)
      
      for (const applicant of toArray) {
        const associationTypes = Array.isArray(applicant.associationTypes)
          ? (applicant.associationTypes as Array<Record<string, unknown>>)
          : []

        const matchingAssociation = associationTypes.find(type => {
          const typeId = type?.typeId
          const isMatch = targetIds.has(String(typeId))
          debug.push(`  Association typeId: ${typeId}, isMatch: ${isMatch}`)
          return isMatch
        })

        const contactId = applicant.toObjectId;
        debug.push(`  Contact: ${contactId}, hasMatchingAssociation: ${!!matchingAssociation}`)
        if (!contactId || !matchingAssociation) continue

        matchingContactIds.set(String(contactId), String(matchingAssociation.typeId))
      }
    }

    debug.push(`Opportunity ${oppId} has ${matchingContactIds.size} matching contacts`)

    const contacts = [];

    for (const [contactId, associationTypeId] of matchingContactIds.entries()) {
      const contactResponse = await hubspotFetch(
        `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email`,
        {
          method: 'GET',
          headers,
        }
      )

      if (!contactResponse.ok) continue;

      const contactData = await safeParseResponse(contactResponse)
      if (contactData && typeof contactData === 'object') {
        contacts.push({
          ...(contactData as HubSpotContact),
          associationTypeId
        })
      }
    }

    applicantsByOpportunity.set(oppId, contacts)
  }

  const finalResult = opportunityIds.map(oppId => ({
    oppId,
    applicants: applicantsByOpportunity.get(oppId) ?? [],
  }))
  debug.push('getApplicantsForOpportunities final result:', finalResult);
  return [finalResult, debug];
}

export async function getOpportunityStage(opportunityId: string): Promise<string | null> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/0-420/${opportunityId}`)
  url.searchParams.set('properties', "hs_pipeline_stage")

  const response = await hubspotFetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    const msg =
      (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    throw new Error(`Failed to fetch opportunity property: ${msg}`)
  }

  const stage = parsed?.properties?.hs_pipeline_stage ?? null
  if (!stage) return null

  return stage;
}

/**
 * Update an opportunity with the provided properties.
 * 
 * @param opportunityId HubSpot opportunity ID
 * @param properties Object with property names as keys and string values
 * @returns Updated opportunity object
 */
export async function updateOpportunityProperties(
  opportunityId: string,
  properties: Record<string, string>
): Promise<HubSpotOpportunity> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const opportunityObjectType = '0-420'
  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v3/objects/${opportunityObjectType}/${opportunityId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })

  if (!response.ok) {
    const error = await safeParseResponse(response)
    const msg = (error && (error.message || error.error || error.text)) || response.statusText
    throw new Error(`HubSpot API error: ${msg}`)
  }

  const parsed = await safeParseResponse(response)
  return parsed
}

export async function isOpportunityRequester(
  userId: string,
  opportunityId: string
): Promise<[boolean, string[]]> {
  if (!getApiKey()) {
    throw new Error('HUBSPOT_API_KEY is not configured')
  }

  const headers = {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }

  const response = await hubspotFetch(`${HUBSPOT_API_BASE}/crm/v4/associations/0-420/contacts/batch/read`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      inputs: [{ "id": opportunityId }]
    }),
  })

  const parsed = await safeParseResponse(response)
  if (!response.ok) {
    const msg = (parsed && (parsed.message || parsed.error || parsed.text)) || response.statusText
    throw new Error(`Failed to list opportunity associations: ${msg}`)
  }

  const results = Array.isArray(parsed?.results) ? parsed.results : [];

  const debug = [];
  debug.push("Requester check:" + JSON.stringify({ userId, opportunityId, results, }, null, 2));

  for (const entry of results) {
    const toArray = Array.isArray(entry?.to) ? entry.to : [];
    
    for (const contact of toArray) {

      const contactId = contact.toObjectId;
      if (contactId !== userId) continue;

      debug.push("Contact association:" + JSON.stringify({ contactId: contact.toObjectId, userId, associationTypes: contact?.associationTypes }));

      const associationTypes = Array.isArray(contact.associationTypes)
        ? (contact.associationTypes as Array<Record<string, unknown>>)
        : []
      
      const isRequester = associationTypes.some(type => {
        debug.push(`  Checking association typeId: ${type?.typeId}`);
        return type.typeId === 12
      });
      return [isRequester, debug];
    }
  }
  return [false, debug];
}