import { z } from 'zod'

export const oneworksRoomCreateInputSchema = z.object({
  entityIds: z.array(z.string().trim().min(1)),
  leaderEntityId: z.string().trim().min(1).optional(),
  leaderMode: z.enum(['automatic', 'entity']).optional(),
  message: z.string().trim().min(1),
  title: z.string().trim().min(1).max(80).optional()
}).strict().superRefine((value, ctx) => {
  if (value.leaderMode === 'automatic') {
    if (value.leaderEntityId != null) {
      ctx.addIssue({ code: 'custom', message: 'Automatic Leader cannot include a leader entity.' })
    }
    if (value.entityIds.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Automatic Leader requires at least one team member.' })
    }
    return
  }
  if (value.leaderMode === 'entity' && value.leaderEntityId == null) {
    ctx.addIssue({ code: 'custom', message: 'A leader entity is required.' })
    return
  }
  if (value.leaderEntityId == null && value.entityIds.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'A leader entity is required.' })
  }
})

export type OneWorksRoomCreateInput = z.infer<typeof oneworksRoomCreateInputSchema>
