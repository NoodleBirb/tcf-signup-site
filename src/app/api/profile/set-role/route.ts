import { NextResponse } from 'next/server'
import { updateContactProperties } from '@/lib/hubspot/api'

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
    const { contactId, role } = body || {}

    if (!contactId || !["student", "employer"].includes(role)) {
      return jsonWithCors(
        { error: "contactId and a valid role ('student' or 'employer') are required" },
        req,
        { status: 400 }
      );
    }

    const property: Record<string, string> = {};
    property[role === "student" ? "is_student" : "is_employer"] = "true";
    await updateContactProperties(contactId, property);
    return jsonWithCors({ success: true }, req)
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonWithCors({ error: message }, req, { status: 500 })
  }
}