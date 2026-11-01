/** Tiny fetch client for the Kept REST and agent APIs. Never logs tokens. */
export async function remote(baseUrl: string, method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(`Could not reach ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const e = json?.error;
    throw new Error(e?.message ? `${e.code ?? res.status}: ${e.message}` : `HTTP ${res.status}`);
  }
  return json;
}
