import hubspotJson from '../../../config/hubspot.json'
import type { TrainingProgramId } from '@/lib/programs/config'

export type HubSpotProgramPipelineConfig = {
  pipelineType: string
  pipelineStage: string
  closedPipelineStage?: string
  /** Hours before session 1 start when registration closes (unless HubSpot `cutoff_time` is set). */
  registrationCloseHoursBeforeStart?: number
}

export type HubSpotConfig = {
  training: {
    objectId: string
    properties: string[]
    scheduleProperties: {
      session1Start: string
      session1End: string
      session2Start: string
      session2End: string
      cutoffTime: string
    }
    /** Fallback when a program omits `registrationCloseHoursBeforeStart`. */
    defaultRegistrationCloseHoursBeforeStart?: number
  }
  associations: {
    registrant: string
    cancelled: string
    waitlist?: string
    unwaitlisted?: string
    registrantTypeId?: string
    cancelledTypeId?: string
    waitlistTypeId?: string
    unwaitlistedTypeId?: string
  }
  programs: Record<TrainingProgramId, HubSpotProgramPipelineConfig>
  contactProperties: {
    firstName: string
    lastName: string
    email: string
    phone: string
    hometownCity: string
    hometownState: string
    currentYear: string
    virginiaResident: string
    interestReason: string
    communitySupport: string
  }
  smsConsent: {
    property: string
    yesValue: string
    noValue: string
  }
  /** Set on every training signup so a HubSpot workflow can enroll the contact. */
  signupWorkflowFlag: {
    property: string
    value: string
  }
  unregister: {
    mode: 'remove' | 'relabel'
  }
}

export const hubspotConfig = hubspotJson as HubSpotConfig

export function getHubSpotApiKey() {
  return process.env.HUBSPOT_API_KEY?.trim() ?? ''
}

export function getTrainingObjectId() {
  return hubspotConfig.training.objectId
}

export function getTrainingProperties() {
  return hubspotConfig.training.properties
}

export function getTrainingSchedulePropertyKeys() {
  return hubspotConfig.training.scheduleProperties
}

export function getTrainingCutoffPropertyKey() {
  return hubspotConfig.training.scheduleProperties.cutoffTime
}

export function getRegistrantAssociationLabel() {
  return hubspotConfig.associations.registrant
}

export function getCancelledAssociationLabel() {
  return hubspotConfig.associations.cancelled
}

export function getWaitlistAssociationLabel() {
  return hubspotConfig.associations.waitlist ?? 'waitlist'
}

export function getRegistrantAssociationTypeId() {
  return hubspotConfig.associations.registrantTypeId?.trim()
}

export function getCancelledAssociationTypeId() {
  return hubspotConfig.associations.cancelledTypeId?.trim()
}

export function getWaitlistAssociationTypeId() {
  return hubspotConfig.associations.waitlistTypeId?.trim()
}

export function getUnwaitlistedAssociationLabel() {
  return hubspotConfig.associations.unwaitlisted ?? 'unwaitlisted'
}

export function getUnwaitlistedAssociationTypeId() {
  return hubspotConfig.associations.unwaitlistedTypeId?.trim()
}

export function getProgramPipelineConfigFromHubSpot(programId: TrainingProgramId) {
  return hubspotConfig.programs[programId]
}

export function getRegistrationCloseHoursBeforeStart(programId: TrainingProgramId): number {
  const programHours = hubspotConfig.programs[programId].registrationCloseHoursBeforeStart
  if (typeof programHours === 'number' && programHours > 0) {
    return programHours
  }

  const defaultHours = hubspotConfig.training.defaultRegistrationCloseHoursBeforeStart
  if (typeof defaultHours === 'number' && defaultHours > 0) {
    return defaultHours
  }

  return 48
}

export function getContactPropertyKeys() {
  return hubspotConfig.contactProperties
}

export function getSmsConsentConfig() {
  return hubspotConfig.smsConsent
}

export function getSignupWorkflowFlagConfig() {
  return hubspotConfig.signupWorkflowFlag
}

export function getUnregisterHubSpotModeFromConfig() {
  return hubspotConfig.unregister.mode === 'relabel' ? 'relabel' : 'remove'
}
