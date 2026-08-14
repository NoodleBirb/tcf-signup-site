import { NextResponse } from 'next/server'
import { getOpportunityStage, updateOpportunityProperties } from '@/lib/hubspot/api'

const ALLOWED_ORIGINS = new Set([
  'https://www-trustedcarefoundation-org.sandbox.hs-sites.com',
  'https://www.trustedcarefoundation.org',
])

const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
}

const EDITABLE_STAGES = new Set([
  "905b841f-e858-406f-b9d3-387573bbaa78",
  "1142144040",
  "6f14f8f1-407b-4b5b-99a7-db681b779076"
]);

const ALLOWED_PROPERTIES = new Set([
  "hs_name",
  "is_onetime_event",
  "number_of_available_positions",
  "location_type",
  "expected_start_date",
  "time",
  "position_summary",
  "position_type",
  "time_commitment_type",
  "expected_end_date",
  "other_time_commitment_details",
  "estimated_hours_per_week",
  "compensation_type",
  "hourly_rate",
  "stipend_value",
  "required_skills_experiences",
  "location_availability"
]);

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

function normalizeProperties(value: unknown): Record<string, string> | null {
  if (!value ) return null;

  const properties: Record<string, string> = {};

  for (const [key, propertyValue] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim() || !ALLOWED_PROPERTIES.has(key)) {
      return null;
    }

    if (typeof propertyValue === 'string') {
      properties[key] = propertyValue;
      continue;
    }

    if (typeof propertyValue === 'number' || typeof propertyValue === 'boolean') {
      properties[key] = String(propertyValue);
      continue;
    }

    return null;
  }

  return properties;
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { contactId, opportunityId, properties } = body || {}

    if (!contactId || typeof contactId !== "string") {
      return jsonWithCors({ error: 'Missing contactId' }, req, { status: 400 })
    }

    if (!opportunityId || typeof opportunityId !== "string") {
      return jsonWithCors({ error: 'Missing opportunityId' }, req, { status: 400 })
    }

    const stage = getOpportunityStage(opportunityId);
    if (!stage || !EDITABLE_STAGES.has(String(stage))) {
      return jsonWithCors(
        { error: 'Opportunity is no longer editable' },
        req,
        { status: 409 }
      )
    }

    const normalizedProperties = normalizeProperties(properties);
    if (!normalizedProperties || Object.keys(normalizedProperties).length === 0) {
      return jsonWithCors({ error: 'Invalid properties' }, req, { status: 400 })
    }

    await updateOpportunityProperties(opportunityId, normalizedProperties);
    return jsonWithCors({ success: true }, req)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonWithCors({ error: message }, req, { status: 500 })
  }
}