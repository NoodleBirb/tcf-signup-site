import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signupRequestBody } from '@/test/fixtures/signup'

const {
  loadProgramEventById,
  getContactByEmail,
  isContactRegisteredForTraining,
  isContactRegisteredForAnotherTraining,
  isContactOnWaitlistForTraining,
  createOrUpdateContact,
  getOrCreateCompanyByWebsite,
  associateContactToCompany,
  associateContactToTraining,
  sendRegistrationConfirmationEmail,
  sendWaitlistConfirmationEmail,
  sendWaitlistStaffNotificationEmail,
} = vi.hoisted(() => ({
  loadProgramEventById: vi.fn(),
  getContactByEmail: vi.fn(),
  isContactRegisteredForTraining: vi.fn(),
  isContactRegisteredForAnotherTraining: vi.fn(),
  isContactOnWaitlistForTraining: vi.fn(),
  createOrUpdateContact: vi.fn(),
  getOrCreateCompanyByWebsite: vi.fn(),
  associateContactToCompany: vi.fn(),
  associateContactToTraining: vi.fn(),
  sendRegistrationConfirmationEmail: vi.fn(),
  sendWaitlistConfirmationEmail: vi.fn(),
  sendWaitlistStaffNotificationEmail: vi.fn(),
}))

vi.mock('@/lib/programs/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/programs/events')>(
    '@/lib/programs/events'
  )
  return {
    ...actual,
    loadProgramEventById,
  }
})

vi.mock('@/lib/signup/email', () => ({
  sendRegistrationConfirmationEmail,
  sendWaitlistConfirmationEmail,
  sendWaitlistStaffNotificationEmail,
}))

vi.mock('@/lib/hubspot/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot/api')>('@/lib/hubspot/api')
  return {
    ...actual,
    getContactByEmail,
    isContactRegisteredForTraining,
    isContactRegisteredForAnotherTraining,
    isContactOnWaitlistForTraining,
    createOrUpdateContact,
    getOrCreateCompanyByWebsite,
    associateContactToCompany,
    associateContactToTraining,
  }
})

import { signupFormContent } from '@/lib/content'
import { alreadyRegisteredAnotherTrainingMessage } from '@/lib/signup/messages'
import { POST } from './route'

function postSignup(body: unknown) {
  return POST(
    new Request('http://localhost/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

describe('POST /api/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProgramEventById.mockResolvedValue({
      event: {
        id: 'event-123',
        title: 'MHFA Session A',
        schedule: { session1Start: '2026-06-10T15:00:00.000Z', session1End: '2026-06-10T21:00:00.000Z' },
        location: 'Virtual',
        isFull: false,
        active: true,
        availableCapacity: 5,
      },
      error: null,
    })
    getContactByEmail.mockResolvedValue(null)
    isContactRegisteredForTraining.mockResolvedValue(false)
    isContactRegisteredForAnotherTraining.mockResolvedValue(false)
    isContactOnWaitlistForTraining.mockResolvedValue(false)
    createOrUpdateContact.mockResolvedValue({ id: 'contact-1' })
    getOrCreateCompanyByWebsite.mockResolvedValue({ id: 'company-1' })
    associateContactToCompany.mockResolvedValue(undefined)
    associateContactToTraining.mockResolvedValue(undefined)
    sendRegistrationConfirmationEmail.mockResolvedValue({ delivered: true, devLogged: false })
    sendWaitlistConfirmationEmail.mockResolvedValue({ delivered: true, devLogged: false })
    sendWaitlistStaffNotificationEmail.mockResolvedValue({ delivered: true, devLogged: false })
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await postSignup({ eventId: 'event-123', program: 'mhfa', data: {} })
    expect(res.status).toBe(400)
  })

  it('returns 409 when registration is closed', async () => {
    loadProgramEventById.mockResolvedValue({
      event: {
        id: 'event-123',
        isFull: false,
        registrationClosed: true,
        availableCapacity: 5,
      },
      error: null,
    })

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: signupFormContent.messages.registrationClosed })
  })

  it('waitlists when the event is full and active', async () => {
    loadProgramEventById.mockResolvedValue({
      event: {
        id: 'event-123',
        isFull: true,
        active: true,
        availableCapacity: 0,
        availableWaitlistCapacity: 2,
        waitlistFull: false,
      },
      error: null,
    })

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      waitlisted: true,
    })
    expect(associateContactToTraining).toHaveBeenCalledWith(
      'contact-1',
      'event-123',
      'waitlist',
      'mhfa'
    )
    expect(sendWaitlistConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane.doe@example.edu',
        firstName: 'Jane',
        program: 'mhfa',
        event: expect.objectContaining({ id: 'event-123' }),
      })
    )
    expect(sendRegistrationConfirmationEmail).not.toHaveBeenCalled()
    expect(sendWaitlistStaffNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        studentFirstName: 'Jane',
        studentLastName: 'Doe',
        studentEmail: 'jane.doe@example.edu',
        program: 'mhfa',
        event: expect.objectContaining({ id: 'event-123' }),
      })
    )
  })

  it('returns 409 when the waitlist is full', async () => {
    loadProgramEventById.mockResolvedValue({
      event: {
        id: 'event-123',
        isFull: true,
        active: true,
        availableCapacity: 0,
        availableWaitlistCapacity: 0,
        waitlistFull: true,
      },
      error: null,
    })

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: signupFormContent.messages.waitlistFull,
    })
  })

  it('returns 409 when the event is inactive', async () => {
    loadProgramEventById.mockResolvedValue({
      event: { id: 'event-123', isFull: true, active: false, availableCapacity: 0 },
      error: null,
    })

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: signupFormContent.messages.trainingUnavailable,
    })
  })

  it('returns 409 when the contact is already registered for another training', async () => {
    getContactByEmail.mockResolvedValue({ id: 'contact-1' })
    isContactRegisteredForAnotherTraining.mockResolvedValue(true)

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: alreadyRegisteredAnotherTrainingMessage(signupFormContent.messages),
    })
    expect(createOrUpdateContact).not.toHaveBeenCalled()
    expect(isContactRegisteredForAnotherTraining).toHaveBeenCalledWith(
      'contact-1',
      'event-123',
      'mhfa'
    )
  })

  it('returns 409 when waitlisting while active on another training in the program', async () => {
    getContactByEmail.mockResolvedValue({ id: 'contact-1' })
    isContactRegisteredForAnotherTraining.mockResolvedValue(true)
    loadProgramEventById.mockResolvedValue({
      event: {
        id: 'event-123',
        isFull: true,
        waitlistFull: false,
        active: true,
        availableCapacity: 0,
        availableWaitlistCapacity: 5,
      },
      error: null,
    })

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: alreadyRegisteredAnotherTrainingMessage(signupFormContent.messages),
    })
    expect(createOrUpdateContact).not.toHaveBeenCalled()
  })

  it('returns 409 when the contact is already registered', async () => {
    getContactByEmail.mockResolvedValue({ id: 'contact-1' })
    isContactRegisteredForTraining.mockResolvedValue(true)

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: signupFormContent.messages.alreadyRegistered,
    })
    expect(createOrUpdateContact).not.toHaveBeenCalled()
  })

  it('returns 409 when the contact is already on the waitlist', async () => {
    getContactByEmail.mockResolvedValue({ id: 'contact-1' })
    isContactOnWaitlistForTraining.mockResolvedValue(true)

    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: signupFormContent.messages.alreadyOnWaitlist,
    })
  })

  it('returns success when HubSpot sync succeeds', async () => {
    const res = await postSignup(signupRequestBody())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      waitlisted: false,
      hubspotContactId: 'contact-1',
    })
    expect(associateContactToTraining).toHaveBeenCalledWith(
      'contact-1',
      'event-123',
      'registrant',
      'mhfa'
    )
    expect(sendRegistrationConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane.doe@example.edu',
        firstName: 'Jane',
        program: 'mhfa',
        event: expect.objectContaining({ id: 'event-123' }),
      })
    )
  })
})
