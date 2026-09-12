export class GoogleApiError extends Error {
  constructor(
    readonly service: "calendar" | "drive",
    readonly operation: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`${service} ${operation} failed (${status})${providerMessage(responseBody) ? `: ${providerMessage(responseBody)}` : ""}`);
    this.name = "GoogleApiError";
  }

  get reconnectRequired(): boolean {
    if (this.status === 401) return true;
    return this.status === 403 && /insufficient.*scope|auth.*scope|invalid credentials/i.test(this.responseBody);
  }
}

function providerMessage(body: string): string | null {
  try {
    const value = JSON.parse(body) as { error?: { message?: unknown } };
    return typeof value.error?.message === "string" ? value.error.message.slice(0, 300) : null;
  } catch {
    return null;
  }
}

export async function expectGoogleResponse(
  response: Response,
  service: "calendar" | "drive",
  operation: string,
): Promise<Response> {
  if (response.ok) return response;
  throw new GoogleApiError(service, operation, response.status, await response.text());
}
