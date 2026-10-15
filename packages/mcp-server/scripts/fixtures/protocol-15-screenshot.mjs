import { z } from 'zod'

import { DesignTaskParameterSchema, DesignTaskEpochSchema } from './protocol-13-design-task.mjs'

// Frozen protocol 15 screenshot arguments from 453b274b (extension 0.23.1).
// Never derive this receiving schema from the current shared package.
export const GetScreenshotParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    nodeIds: z.array(z.string().min(1)).min(1).optional()
  })
  .superRefine((value, context) => {
    if (value.nodeId !== undefined && value.nodeIds !== undefined) {
      context.addIssue({ code: 'custom', message: 'Use only one of nodeId or nodeIds.' })
    }
  })
