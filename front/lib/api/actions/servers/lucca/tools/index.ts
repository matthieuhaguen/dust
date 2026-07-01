import { MCPError } from "@app/lib/actions/mcp_errors";
import type { ToolHandlers } from "@app/lib/actions/mcp_internal_actions/tool_definition";
import { buildTools } from "@app/lib/actions/mcp_internal_actions/tool_definition";
import { getLuccaClient } from "@app/lib/api/actions/servers/lucca/client";
import { LUCCA_TOOLS_METADATA } from "@app/lib/api/actions/servers/lucca/metadata";
import type { LuccaUser } from "@app/lib/api/actions/servers/lucca/types";
import {
  LuccaUserResponseSchema,
  LuccaUsersResponseSchema,
} from "@app/lib/api/actions/servers/lucca/types";
import { Err, Ok } from "@app/types/shared/result";

const DEFAULT_USERS_LIMIT = 50;

function formatLuccaUser(user: LuccaUser): string {
  const name =
    user.displayName ??
    [user.firstName, user.lastName].filter(Boolean).join(" ") ??
    "Unknown";
  const email = user.mail ?? user.login ?? "no email";
  return `#${user.id} — ${name} (${email})`;
}

const handlers: ToolHandlers<typeof LUCCA_TOOLS_METADATA> = {
  get_my_info: async (_params, extra) => {
    const clientResult = getLuccaClient(extra);
    if (clientResult.isErr()) {
      return new Err(clientResult.error);
    }

    const result = await clientResult.value.get(
      "/api/v3/users/me",
      LuccaUserResponseSchema
    );
    if (result.isErr()) {
      return new Err(
        new MCPError(
          `Failed to retrieve Lucca account info: ${result.error.message}`
        )
      );
    }

    return new Ok([
      {
        type: "text" as const,
        text: `Your Lucca account: ${formatLuccaUser(result.value.data)}`,
      },
    ]);
  },

  list_users: async ({ limit }, extra) => {
    const clientResult = getLuccaClient(extra);
    if (clientResult.isErr()) {
      return new Err(clientResult.error);
    }

    const result = await clientResult.value.get(
      "/api/v3/users?fields=id,firstName,lastName,mail,displayName,login",
      LuccaUsersResponseSchema
    );
    if (result.isErr()) {
      return new Err(
        new MCPError(`Failed to list Lucca users: ${result.error.message}`)
      );
    }

    const users = result.value.data.items.slice(
      0,
      limit ?? DEFAULT_USERS_LIMIT
    );
    if (users.length === 0) {
      return new Ok([{ type: "text" as const, text: "No Lucca users found." }]);
    }

    const formatted = users.map(formatLuccaUser).join("\n");
    return new Ok([
      {
        type: "text" as const,
        text: `Found ${users.length} Lucca user(s):\n\n${formatted}`,
      },
    ]);
  },
};

export const TOOLS = buildTools(LUCCA_TOOLS_METADATA, handlers);
