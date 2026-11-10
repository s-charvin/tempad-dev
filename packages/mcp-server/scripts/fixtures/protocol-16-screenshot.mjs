import { z } from 'zod'

import { DesignTaskParameterSchema, DesignTaskEpochSchema } from './protocol-13-design-task.mjs'

// Frozen protocol 16 screenshot arguments from 6dc7757 (extension 0.23.4).
// The receiving envelopes remain unchanged from protocol 13.
export { MessageToExtensionSchema } from './extension-0.22.0.mjs'
export const GetScreenshotParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    sessionId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    nodeIds: z.array(z.string().min(1)).min(1).optional(),
    scale: z.number().positive().optional()
  })
  .superRefine((value, context) => {
    if (value.nodeId !== undefined && value.nodeIds !== undefined) {
      context.addIssue({ code: 'custom', message: 'Use only one of nodeId or nodeIds.' })
    }
  })
