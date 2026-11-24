import { z } from 'zod';
import { auctionModeLabels, auctionModeRules } from './domain';
import { settingsErrors } from './settings-rules';

export const settingsSchema = z.object({
  name: z.string().trim().min(3).max(60).default('Friday Night Auction'),
  mode: z.enum(['quick', 'standard', 'mega']).optional(),
  teamCount: z.number().int().min(2).max(10).default(4),
  budget: z.number().int().min(200).max(20000).default(8000),
  minSquad: z.number().int().min(1).max(11).default(2),
  maxSquad: z.number().int().min(2).max(12).default(8),
  maxOverseas: z.number().int().min(0).max(12).default(4),
  timerSeconds: z.number().int().min(10).max(120).default(30),
  lateExtension: z.boolean().default(true),
  bidIncrement: z.number().int().min(5).max(100).default(10),
  autoAdvance: z.boolean().default(true),
  resultSeconds: z.number().int().min(2).max(20).default(5),
  spectators: z.boolean().default(true),
}).strict().superRefine((settings, ctx) => {
  if (settings.minSquad > settings.maxSquad) {
    ctx.addIssue({ code: 'custom', message: 'Minimum squad cannot exceed maximum squad' });
  }
  if (settings.mode) {
    const rules = auctionModeRules[settings.mode], label = auctionModeLabels[settings.mode];
    if (settings.budget !== rules.purse) ctx.addIssue({ code: 'custom', message: `${label} mode uses a fixed purse of ₹${rules.purse / 100} Cr.` });
    if (settings.minSquad !== rules.squad || settings.maxSquad !== rules.squad) ctx.addIssue({ code: 'custom', message: `${label} mode uses a squad of exactly ${rules.squad} players.` });
    if (settings.maxOverseas !== rules.maxOverseas) ctx.addIssue({ code: 'custom', message: `${label} mode allows at most ${rules.maxOverseas} overseas players.` });
    if (settings.timerSeconds !== rules.timerSeconds) ctx.addIssue({ code: 'custom', message: `${label} mode uses a ${rules.timerSeconds}-second bid timer.` });
    if (settings.minSquad * settings.teamCount > rules.players) ctx.addIssue({ code: 'custom', message: `The ${label} player pool cannot satisfy ${settings.teamCount} teams with a minimum squad of ${settings.minSquad}.` });
  } else if (settings.minSquad * settings.teamCount > 24) {
    ctx.addIssue({ code: 'custom', message: 'Player pool cannot satisfy minimum squad sizes' });
  }
});
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
 ...(['start','pause','resume','next','end','start-recall'] as const).map(type => z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal(type)}).strict()),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('plan-preview'),mode:z.enum(['quick','standard','mega']),seed:z.string().max(200).optional()}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('plan-regenerate'),mode:z.enum(['quick','standard','mega']),seed:z.string().max(200).optional()}).strict(),
 z.object({expectedVersion:z.number().int().nonnegative().optional(),id:z.string().min(1).max(100),type:z.literal('plan-approve'),planVersion:z.number().int().nonnegative()}).strict(),
]);
export type Action = z.infer<typeof actionSchema>;

export * from './domain';
export * from './bid-rules';
