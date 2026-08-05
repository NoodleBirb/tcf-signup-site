import { NextResponse } from 'next/server'
import {
  AlreadyRegisteredError,
  associateContactToCompany,
  associateContactToTraining,
  createOrUpdateContact,
  getContactByEmail,
  getOrCreateCompanyByWebsite,
  isContactOnWaitlistForTraining,
  isContactRegisteredForAnotherTraining,
  isContactRegisteredForTraining,
  type ContactData,
} from '@/lib/hubspot/api'
import { signupFormContent } from '@/lib/content'
import { alreadyRegisteredAnotherTrainingMessage } from '@/lib/signup/messages'
import { formatSignupFormData, isSignupFormatError } from '@/lib/signup/format-fields'
import { canAcceptRegistration, canAcceptWaitlist, loadProgramEventById } from '@/lib/programs/events'
import { isTrainingProgramId } from '@/lib/programs/config'
import {
  sendRegistrationConfirmationEmail,
  sendWaitlistConfirmationEmail,
  sendWaitlistStaffNotificationEmail,
} from '@/lib/signup/email'

export const dynamic = 'force-dynamic'

const alreadyRegisteredAnotherTrainingError = alreadyRegisteredAnotherTrainingMessage(
  signupFormContent.messages
)

export async function POST(req: Request) {
  const messages = signupFormContent.messages

  try {
    const body = await req.json()
    const { eventId, program, data } = body || {}

    if (!eventId) {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })
    }

    if (!program || !isTrainingProgramId(program)) {
      return NextResponse.json({ error: 'Missing or invalid program (mhfa or qpr)' }, { status: 400 })
    }

    // Basic validation — check required fields
    if (
      !data ||
      !data.firstName ||
      !data.lastName ||
      !data.email ||
      !data.phone ||
      !data.hometownCity ||
      !data.hometownState ||
      !data.universityWebsite ||
      !data.currentYear ||
      !data.isVirginiaResident ||
      !data.interestReason ||
      !data.communitySupport
    ) {
      return NextResponse.json({ error: messages.missingRequiredFields }, { status: 400 })
    }

    const formatted = formatSignupFormData(data)
    if (isSignupFormatError(formatted)) {
      return NextResponse.json({ error: formatted.error }, { status: 400 })
    }

    const { event: ev, error: eventError } = await loadProgramEventById(program, eventId)

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 })
    }

    if (!ev) {
      return NextResponse.json({ error: messages.trainingNotFound }, { status: 404 })
    }

    if (ev.registrationClosed) {
      return NextResponse.json({ error: messages.registrationClosed }, { status: 409 })
    }

    const waitlisted = canAcceptWaitlist(ev)
    if (!canAcceptRegistration(ev) && !waitlisted) {
      if (!ev.active) {
        return NextResponse.json({ error: messages.trainingUnavailable }, { status: 409 })
      }
      if (ev.isFull && ev.waitlistFull) {
        return NextResponse.json({ error: messages.waitlistFull }, { status: 409 })
      }
      return NextResponse.json({ error: messages.trainingFull }, { status: 409 })
    }

    const existingContact = await getContactByEmail(formatted.email)
    if (existingContact?.id) {
      if (await isContactRegisteredForTraining(existingContact.id, eventId)) {
        return NextResponse.json({ error: messages.alreadyRegistered }, { status: 409 })
      }
      if (await isContactOnWaitlistForTraining(existingContact.id, eventId)) {
        return NextResponse.json({ error: messages.alreadyOnWaitlist }, { status: 409 })
      }
      if (await isContactRegisteredForAnotherTraining(existingContact.id, eventId, program)) {
        return NextResponse.json({ error: alreadyRegisteredAnotherTrainingError }, { status: 409 })
      }
    }

    // Contact data with all form fields
    const contactData: ContactData = {
      firstName: formatted.firstName,
      lastName: formatted.lastName,
      email: formatted.email,
      phone: formatted.phone,
      hometownCity: formatted.hometownCity,
      hometownState: formatted.hometownState,
      currentYear: formatted.currentYear,
      isVirginiaResident: formatted.isVirginiaResident,
      trainingDates: data.trainingDates,
      interestReason: formatted.interestReason,
      communitySupport: formatted.communitySupport,
      smsConsent: formatted.smsConsent,
    }

    let hubspotContactId: string

    try {
      const contact = await createOrUpdateContact(contactData)
      hubspotContactId = contact.id

      if (await isContactRegisteredForTraining(hubspotContactId, eventId)) {
        return NextResponse.json({ error: messages.alreadyRegistered }, { status: 409 })
      }
      if (await isContactOnWaitlistForTraining(hubspotContactId, eventId)) {
        return NextResponse.json({ error: messages.alreadyOnWaitlist }, { status: 409 })
      }
      if (await isContactRegisteredForAnotherTraining(hubspotContactId, eventId, program)) {
        return NextResponse.json({ error: alreadyRegisteredAnotherTrainingError }, { status: 409 })
      }

      // Create or find the company by website and associate the contact to it
      try {
        const company = await getOrCreateCompanyByWebsite(formatted.universityWebsite)
        await associateContactToCompany(hubspotContactId, company.id)
      } catch (companyError: unknown) {
        const message = companyError instanceof Error ? companyError.message : String(companyError)
        console.error('Company creation/association error:', message)
        // Don't fail the entire signup if company association fails
      }

      await associateContactToTraining(
        hubspotContactId,
        eventId,
        waitlisted ? 'waitlist' : 'registrant',
        program
      )
    } catch (hsError: unknown) {
      if (hsError instanceof AlreadyRegisteredError) {
        return NextResponse.json({ error: hsError.message }, { status: 409 })
      }
      const hubspotError =
        hsError instanceof Error ? hsError.message : 'HubSpot sync failed'
      console.error('HubSpot integration error:', hubspotError)
      return NextResponse.json({ error: messages.signupUnavailable }, { status: 502 })
    }

    try {
      const emailInput = {
        to: formatted.email,
        firstName: formatted.firstName,
        program,
        event: ev,
      }
      if (waitlisted) {
        await sendWaitlistConfirmationEmail(emailInput)
        try {
          await sendWaitlistStaffNotificationEmail({
            studentFirstName: formatted.firstName,
            studentLastName: formatted.lastName,
            studentEmail: formatted.email,
            studentPhone: formatted.phone,
            program,
            event: ev,
          })
        } catch (staffEmailError) {
          console.error('Waitlist staff notification email failed:', staffEmailError)
        }
      } else {
        await sendRegistrationConfirmationEmail(emailInput)
      }
    } catch (emailError) {
      console.error('Registration confirmation email failed:', emailError)
    }

    return NextResponse.json({
      success: true,
      waitlisted,
      event: { id: ev.id, availableCapacity: ev.availableCapacity },
      hubspotContactId,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
