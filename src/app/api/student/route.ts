import { NextResponse } from 'next/server'
import { updateContactProperties } from '@/lib/hubspot/api'

const ALLOWED_ORIGINS = new Set([
  'https://www-trustedcarefoundation-org.sandbox.hs-sites.com',
  'https://www.trustedcarefoundation.org',
])

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

const ALLOWED_STUDENT_PROPERTIES = new Set([
  'firstname',
  'lastname',
  'phone',
  'email',
  'hometown_city',
  'hometown_state',
  'college_major',
  'current_year_in_school',
  'graduation_date',
  'n18_yet',
  'when_18_mdy',
  'pediatric_health_interest',
  'what_areas_might_interest_you__select_all_that_apply_',
  'please_discuss_some_of_your_areas_of_interest_',
  'what_level_of_interest_do_you_have_with_trusted_care_foundation__select_all_that_apply_to_you_',
  'we_strive_to_make_our_programs_accessible_for_all_students___do_you_identify_with_any_of_the_follow',
  'race',
  'hispanic_latino_origin',
  'gender_identity',
  'gender_identity_explanation',
  'are_you_a_first_generation_immigrant_',
  'other_fluent_language',
  'fluent_languages_other'
])

export const dynamic = 'force-dynamic'

function getAllowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  return origin && ALLOWED_ORIGINS.has(origin) ? origin : null
}

function jsonWithCors(body: unknown, req: Request, init?: ResponseInit) {
  const allowedOrigin = getAllowedOrigin(req)
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
      ...BASE_CORS_HEADERS,
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
}

function normalizeProperties(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const properties: Record<string, string> = {}

  for (const [key, propertyValue] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim() || !ALLOWED_STUDENT_PROPERTIES.has(key)) {
      return null
    }

    if (typeof propertyValue === 'string') {
      properties[key] = propertyValue
      continue
    }

    if (typeof propertyValue === 'number' || typeof propertyValue === 'boolean') {
      properties[key] = String(propertyValue)
      continue
    }

    return null
  }

  return properties
}

export function OPTIONS(req: Request) {
  const allowedOrigin = getAllowedOrigin(req)
  return new Response(null, {
    status: 204,
    headers: {
      ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
      ...BASE_CORS_HEADERS,
    },
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const contactId = typeof body?.contactId === 'string' ? body.contactId.trim() : undefined
    const properties = normalizeProperties(body?.properties)

    if (!contactId) {
      return jsonWithCors({ error: 'Missing contactId' }, req, { status: 400 })
    }

    if (!properties || Object.keys(properties).length === 0) {
      return jsonWithCors(
        { error: 'Missing or invalid properties' },
        req,
        { status: 400 }
      )
    }

    await updateContactProperties(contactId, properties)
    return jsonWithCors({ success: true }, req)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message === 'Contact not found' ? 404 : 500
    return jsonWithCors({ error: message }, req, { status })
  }
}
