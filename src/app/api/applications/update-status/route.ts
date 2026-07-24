import { NextResponse } from 'next/server'
import { associateContactToOpportunity, disassociateContactFromOpportunity } from '@/lib/hubspot/api'

const ALLOWED_ORIGINS = new Set([
  'https://www-trustedcarefoundation-org.sandbox.hs-sites.com',
  'https://www.trustedcarefoundation.org',
])

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

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
    const { contactId, opportunityId, status } = body || {}

    if (!contactId) {
      return jsonWithCors({ error: 'Missing contactId' }, req, { status: 400 })
    }

    if (!opportunityId || typeof opportunityId !== 'string') {
      return jsonWithCors({ error: 'Missing opportunityId' }, req, { status: 400 })
    }

    const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : ''
    const hubspotStatusId =
      normalizedStatus === 'in-review'
        ? 23
        : normalizedStatus === 'offer' || normalizedStatus === 'accept'
          ? 5
          : normalizedStatus === 'pass'
            ? 45
            : normalizedStatus === 'withdraw' || normalizedStatus === 'decline'
              ? 9
              : null

    if (hubspotStatusId === null) {
      return jsonWithCors({ error: 'Unsupported status' }, req, { status: 400 })
    }

    await associateContactToOpportunity(contactId, opportunityId, "USER_DEFINED", hubspotStatusId)

    const disassociateStatusIds = normalizedStatus === 'in-review' ? [22, 5, 45] : [19, 23]
    for (const disassociateStatusId of disassociateStatusIds) {
      await disassociateContactFromOpportunity(contactId, opportunityId, "USER_DEFINED", disassociateStatusId)
    }

    return jsonWithCors({ success: true }, req)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonWithCors({ error: message }, req, { status: 500 })
  }
}