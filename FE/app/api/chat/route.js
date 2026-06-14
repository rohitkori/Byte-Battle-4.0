export async function POST(request) {
  const payload = await request.json().catch(() => ({}));
  const query = typeof payload.query === "string" ? payload.query.trim() : "";

  return Response.json({
    reply: query ? `Demo API received your query: ${query}` : "Demo API received an empty query.",
  });
}
