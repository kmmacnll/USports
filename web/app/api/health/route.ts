// Render health check for the web service (does not depend on the API).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
