import { describe, expect, it } from 'vitest'
import {
  getCancelledAssociationLabel,
  getContactPropertyKeys,
  getRegistrationCloseHoursBeforeStart,
  getRegistrantAssociationLabel,
  getSignupWorkflowFlagConfig,
  getSmsConsentConfig,
  getTrainingProperties,
  hubspotConfig,
} from '@/lib/hubspot/config'

describe('hubspot config', () => {
  it('loads portal wiring from config/hubspot.json', () => {
    expect(hubspotConfig.programs.mhfa.pipelineType).toBeTruthy()
    expect(hubspotConfig.programs.qpr.pipelineStage).toBeTruthy()
    expect(getTrainingProperties()).toContain('cutoff_time')
    expect(getRegistrantAssociationLabel()).toBe('registrant')
    expect(getCancelledAssociationLabel()).toBe('unregistered')
    expect(getContactPropertyKeys().email).toBe('email')
    expect(getSmsConsentConfig().yesValue).toBeTruthy()
    expect(getSignupWorkflowFlagConfig().property).toBeTruthy()
    expect(getSignupWorkflowFlagConfig().value).toBe('Yes')
  })

  it('reads per-program registration close hours from config', () => {
    expect(getRegistrationCloseHoursBeforeStart('mhfa')).toBe(48)
    expect(getRegistrationCloseHoursBeforeStart('qpr')).toBe(24)
    expect(hubspotConfig.training.defaultRegistrationCloseHoursBeforeStart).toBe(48)
  })
})
