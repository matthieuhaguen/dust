import type { ServerMetadata } from "@app/lib/actions/mcp_internal_actions/tool_definition";
import { createToolsRecord } from "@app/lib/actions/mcp_internal_actions/tool_definition";
import type { JSONSchema7 as JSONSchema } from "json-schema";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const LUCCA_TOOLS_METADATA = createToolsRecord({
  get_my_info: {
    description:
      "Get the Lucca employee information of the user whose API key is " +
      "configured (the current user). Useful to retrieve your own id, name " +
      "and email in Lucca.",
    schema: {},
    stake: "never_ask",
    displayLabels: {
      running: "Retrieving Lucca account info",
      done: "Retrieve Lucca account info",
    },
  },
  list_users: {
    description:
      "List employees from the Lucca directory. Returns minimal fields (id, " +
      "name, email) for each user.",
    schema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Maximum number of users to return (default: 50, max: 200)."),
    },
    stake: "never_ask",
    displayLabels: {
      running: "Listing Lucca users",
      done: "List Lucca users",
    },
  },
});

export const LUCCA_SERVER = {
  serverInfo: {
    name: "lucca",
    version: "1.0.0",
    description: "Access Lucca HR data: employees and directory.",
    authorization: null,
    icon: "ActionTableIcon",
    documentationUrl: null,
    instructions: null,
  },
  tools: Object.values(LUCCA_TOOLS_METADATA).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(z.object(t.schema)) as JSONSchema,
    displayLabels: t.displayLabels,
  })),
  tools_stakes: Object.fromEntries(
    Object.values(LUCCA_TOOLS_METADATA).map((t) => [t.name, t.stake])
  ),
} as const satisfies ServerMetadata;
