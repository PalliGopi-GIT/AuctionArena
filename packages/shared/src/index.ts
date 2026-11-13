import { z } from 'zod';
import { settingsErrors } from './settings-rules';

export const settingsSchema = z.object({
  name: z.string().trim().min(3).max(60).default('Friday Night Auction'),
  teamCount: z.number().int().min(2).max(8).default(4),
  budget: z.number().int().min(200).max(20000).default(8000),
  minSquad: z.number().int().min(1).max(4).default(2),
  maxSquad: z.number().int().min(2).max(12).default(8),
  maxOverseas: z.number().int().min(0).max(12).default(4),
  timerSeconds: z.number().int().min(10).max(120).default(30),
  lateExtension: z.boolean().default(true),
  bidIncrement: z.number().int().min(5).max(100).default(10),
  autoAdvance: z.boolean().default(true),
  resultSeconds: z.number().int().min(2).max(20).default(5),
  spectators: z.boolean().default(true),
}).strict().refine(s => s.minSquad <= s.maxSquad, 'Minimum squad cannot exceed maximum squad').refine(s => s.minSquad * s.teamCount <= 24, 'Player pool cannot satisfy minimum squad sizes');
export type Settings = z.infer<typeof settingsSchema>;
// Defaults are for creation; updates must pass the actor's complete-settings guard first.
// Zod 4 pipes use the downstream input type, which includes its optional defaulted fields.
const updateSettingsSchema = z.custom<z.input<typeof settingsSchema>>(
 value => settingsErrors(value).length === 0, 'Complete valid room settings are required.',
).pipe(settingsSchema);
export const actionSchema = z.discriminatedUnion('type', [
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('update-settings'),settings:updateSettingsSchema}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('leave')}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('remove-member'),memberId:z.string().min(1).max(200)}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('claim'),teamId:z.string()}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('ready')}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('bid'),amount:z.number().int().positive(),playerId:z.string()}).strict(),
 ...(['start','pause','resume','next','end'] as const).map(type => z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal(type)}).strict()),
]);
export type Action = z.infer<typeof actionSchema>;

export * from './domain';
export * from './bid-rules';
