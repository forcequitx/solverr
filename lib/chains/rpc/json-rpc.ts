/** The error part of a JSON-RPC answer; NEAR RPC also names the error and its cause. */
type JsonRpcError = { name?: string; cause?: { name?: string }; message?: string };

const DEFAULT_TIMEOUT_MS = 10_000;

/** One JSON-RPC 2.0 POST returning `result` or `error`; non-2xx throws. No server-only imports, so browser balance reads use it too. */
export async function jsonRpc<T>(url: string, method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ result?: T; error?: JsonRpcError }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`);
  return (await response.json()) as { result?: T; error?: JsonRpcError };
}
