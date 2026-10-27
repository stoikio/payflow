import type { Context } from 'hono';
import { z } from 'zod';

import { ApiError } from '#src/lib/errors.ts';

export const Metadata = z
  .record(z.string().max(40), z.string().max(500))
  .refine((metadata) => Object.keys(metadata).length <= 20, { error: 'At most 20 keys' })
  .default({});

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startingAfter: z.string().optional(),
});

export const parse = <Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const [issue] = result.error.issues;
    throw new ApiError({
      status: 400,
      code: 'validation_failed',
      message: issue
        ? `${issue.path.join('.') || 'body'}: ${issue.message}`
        : 'Invalid request',
      param: issue?.path.join('.') || undefined,
    });
  }
  return result.data;
};

export const jsonBody = async (c: Context): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError({
      status: 400,
      code: 'invalid_json',
      message: 'Request body must be JSON',
    });
  }
};

/** Lists are newest first: `{ data, hasMore }`, next page with `startingAfter=<last id>`. */
export const listResponse = <Item>(items: Item[], limit: number) => ({
  data: items.slice(0, limit),
  hasMore: items.length > limit,
});
