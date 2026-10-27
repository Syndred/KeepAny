import { z } from 'zod';
import { assetSchema, historySchema } from '../../domain/src';
export const reviewedAcceptanceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('asset'), value: assetSchema }).strict(),
  z.object({ type: z.literal('history'), value: historySchema }).strict(),
]);
export type ReviewedAcceptance = z.infer<typeof reviewedAcceptanceSchema>;
