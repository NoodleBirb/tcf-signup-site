import { NextResponse } from 'next/server'
import { updateContactProperties, updateCompanyProperties } from '@/lib/hubspot/api'

const ALLOWED_ORIGINS = new Set([
  'https://www-trustedcarefoundation-org.sandbox.hs-sites.com',
  'https://www.trustedcarefoundation.org',
])

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

// Allowed contact properties that can be updated via CMS pages
const ALLOWED_CONTACT_PROPERTIES = new Set([
  'firstname',
  'lastname',
  'email'
])

// Allowed company properties that can be updated via CMS pages
const ALLOWED_COMPANY_PROPERTIES = new Set([
  'name',
  'domain',
  'address',
  'address2',
  'city',
  'state',
  'zip',
  'phone',
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

function normalizeProperties(
  value: unknown,
  allowedSet: Set<string>
): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const properties: Record<string, string> = {}

  for (const [key, propertyValue] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim() || !allowedSet.has(key)) {
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
    const companyId = typeof body?.companyId === 'string' ? body.companyId.trim() : undefined

    if (!contactId && !companyId) {
      return jsonWithCors(
        { error: 'At least one of contactId or companyId is required' },
        req,
        { status: 400 }
      )
    }

    const contactProperties = normalizeProperties(body?.contact, ALLOWED_CONTACT_PROPERTIES)
    const companyProperties = normalizeProperties(body?.company, ALLOWED_COMPANY_PROPERTIES)

    if (
      (contactId && (!contactProperties || Object.keys(contactProperties).length === 0)) &&
      (companyId && (!companyProperties || Object.keys(companyProperties).length === 0))
    ) {
      return jsonWithCors(
        { error: 'At least one valid contact or company property is required' },
        req,
        { status: 400 }
      )
    }

    // Update contact if contactId and contact properties are provided
    if (contactId && contactProperties && Object.keys(contactProperties).length > 0) {
      try {
        await updateContactProperties(contactId, contactProperties)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonWithCors(
          { error: `Failed to update contact: ${message}` },
          req,
          { status: 500 }
        )
      }
    }

    // Update company if companyId and company properties are provided
    if (companyId && companyProperties && Object.keys(companyProperties).length > 0) {
      try {
        await updateCompanyProperties(companyId, companyProperties)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return jsonWithCors(
          { error: `Failed to update company: ${message}` },
          req,
          { status: 500 }
        )
      }
    }

    return jsonWithCors({ success: true, updated: { contact: !!contactId, company: !!companyId } }, req)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return jsonWithCors({ error: message }, req, { status: 500 })
  }
}
