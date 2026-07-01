import { MCPError } from "@app/lib/actions/mcp_errors";
import type { ToolHandlerExtra } from "@app/lib/actions/mcp_internal_actions/tool_definition";
import { untrustedFetch } from "@app/lib/egress/server";
import logger from "@app/logger/logger";
import type { Result } from "@app/types/shared/result";
import { Err, Ok } from "@app/types/shared/result";
import { normalizeError } from "@app/types/shared/utils/error_utils";
import { isString } from "@app/types/shared/utils/general";
import type { z } from "zod";

// Credentials are stored as custom headers on the bearer-token MCP connection
// (see server_token_labels.ts). They are NOT sent verbatim to Lucca; the client
// reads them to build the tenant base URL and the custom Authorization header.
export const LUCCA_API_KEY_HEADER = "X-Lucca-Api-Key";
export const LUCCA_SUBDOMAIN_HEADER = "X-Lucca-Subdomain";

const LUCCA_REQUEST_TIMEOUT_MS = 5_000;
// Lucca enforces a 50 req/min per-tenant rate limit and replies with 429 +
// Retry-After. Retry a bounded number of times so a transient throttle does not
// fail the tool call.
const LUCCA_MAX_RETRIES = 2;
const LUCCA_MAX_RETRY_DELAY_MS = 10_000;

/**
 * Normalize a Lucca tenant subdomain into the bare subdomain used to build the
 * base URL `https://{subdomain}.ilucca.net`. Accepts a full URL, a domain, or
 * just the subdomain.
 */
export function normalizeLuccaSubdomain(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const host = trimmed.split("/")[0];
  return host.replace(/\.ilucca\.net$/i, "");
}

class LuccaHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "LuccaHttpError";
  }
}

/**
 * Build a Lucca client from the MCP tool handler context, reading the API key
 * and tenant subdomain from the connection's custom headers.
 */
export function getLuccaClient(
  extra: ToolHandlerExtra
): Result<LuccaClient, MCPError> {
  const rawHeaders = extra.authInfo?.extra?.customHeaders;
  const headers =
    typeof rawHeaders === "object" &&
    rawHeaders !== null &&
    !Array.isArray(rawHeaders)
      ? (rawHeaders as Record<string, unknown>)
      : undefined;

  const apiKey = headers?.[LUCCA_API_KEY_HEADER];
  const subdomain = headers?.[LUCCA_SUBDOMAIN_HEADER];

  if (!isString(apiKey) || !isString(subdomain)) {
    return new Err(
      new MCPError(
        "Lucca credentials not configured. Add the Lucca API key and tenant " +
          "subdomain in the MCP server settings.",
        { tracked: false }
      )
    );
  }

  const normalizedSubdomain = normalizeLuccaSubdomain(subdomain);
  if (!normalizedSubdomain) {
    return new Err(
      new MCPError("Invalid Lucca tenant subdomain.", { tracked: false })
    );
  }

  return new Ok(new LuccaClient(apiKey, normalizedSubdomain));
}

export class LuccaClient {
  private readonly apiKey: string;
  private readonly subdomain: string;

  constructor(apiKey: string, subdomain: string) {
    this.apiKey = apiKey;
    this.subdomain = subdomain;
  }

  private get baseUrl(): string {
    return `https://${this.subdomain}.ilucca.net`;
  }

  async get<T extends z.ZodTypeAny>(
    path: string,
    schema: T
  ): Promise<Result<z.infer<T>, Error>> {
    let attempt = 0;
    // Bounded retry loop honoring Lucca's 429 + Retry-After rate limiting.
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        LUCCA_REQUEST_TIMEOUT_MS
      );

      let response: Awaited<ReturnType<typeof untrustedFetch>>;
      try {
        response = await untrustedFetch(`${this.baseUrl}${path}`, {
          headers: {
            // Lucca legacy v3 uses a non-standard Authorization header.
            Authorization: `lucca application=${this.apiKey}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });
      } catch (err) {
        // Catch around the external fetch only (ERR1): timeouts/network errors.
        return new Err(normalizeError(err));
      } finally {
        // Disarm the timeout as soon as the request settles so it cannot abort
        // the body reads below.
        clearTimeout(timeout);
      }

      if (response.status === 429 && attempt < LUCCA_MAX_RETRIES) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.min(retryAfterSeconds * 1000, LUCCA_MAX_RETRY_DELAY_MS)
            : Math.min(1000 * 2 ** attempt, LUCCA_MAX_RETRY_DELAY_MS);
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        return new Err(
          new LuccaHttpError(
            response.status,
            `Lucca API error (${response.status}): ${errorText || response.statusText}`
          )
        );
      }

      const rawData = await response.json();
      const parseResult = schema.safeParse(rawData);
      if (!parseResult.success) {
        logger.error(
          { path, error: parseResult.error.message },
          "[Lucca] Invalid response format"
        );
        return new Err(
          new Error(`Invalid Lucca API response: ${parseResult.error.message}`)
        );
      }

      return new Ok(parseResult.data);
    }
  }
}
