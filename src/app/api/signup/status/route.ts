import { NextResponse } from 'next/server'
import {
  getContactByEmail,
  isContactOnWaitlistForTraining,
  isContactRegisteredForAnotherTraining,
  isContactRegisteredForTraining,
} from '@/lib/hubspot/api'
import { isTrainingProgramId } from '@/lib/programs/config'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email, eventId, program } = body || {}

    if (!email || typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: 'Missing email' }, { status: 400 })
    }

    if (!eventId || typeof eventId !== 'string') {
      return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })
    }

    if (!program || !isTrainingProgramId(program)) {
      return NextResponse.json({ error: 'Missing or invalid program' }, { status: 400 })
    }

    const contact = await getContactByEmail(email.trim())
    if (!contact?.id) {
      return NextResponse.json({
        registered: false,
        waitlisted: false,
        registeredForAnotherTraining: false,
      })
    }

    const [registered, waitlisted, registeredForAnotherTraining] = await Promise.all([
      isContactRegisteredForTraining(contact.id, eventId),
      isContactOnWaitlistForTraining(contact.id, eventId),
      isContactRegisteredForAnotherTraining(contact.id, eventId, program),
    ])

    return NextResponse.json({ registered, waitlisted, registeredForAnotherTraining })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
