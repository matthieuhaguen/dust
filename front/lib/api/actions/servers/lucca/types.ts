import { z } from "zod";

// Lucca legacy v3 API response envelopes.
//
// Collections are wrapped as `{ data: { items: [...] } }` and single entities
// as `{ data: {...} }`. The schemas below are intentionally lenient
// (`.passthrough()` + nullish optional fields) so that tenant-specific field
// variations do not break parsing. Tighten them once validated against a real
// Lucca tenant.

export const LuccaUserSchema = z
  .object({
    id: z.number(),
    firstName: z.string().nullish(),
    lastName: z.string().nullish(),
    displayName: z.string().nullish(),
    mail: z.string().nullish(),
    login: z.string().nullish(),
  })
  .passthrough();

export type LuccaUser = z.infer<typeof LuccaUserSchema>;

export const LuccaUserResponseSchema = z.object({
  data: LuccaUserSchema,
});

export const LuccaUsersResponseSchema = z.object({
  data: z.object({
    items: z.array(LuccaUserSchema),
  }),
});
