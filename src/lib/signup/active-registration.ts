import { isTrainingEventEnded, type TrainingSchedule } from '@/lib/dates/format-schedule'

/**
 * Whether another training association should block signup in this program.
 * Cross-program trainings and sessions past their end date do not block.
 */
export function doesTrainingBlockProgramSignup(options: {
  trainingPipeline?: string
  programPipelineType?: string
  schedule: TrainingSchedule
  now?: Date
}): boolean {
  const { trainingPipeline, programPipelineType, schedule, now = new Date() } = options

  if (
    programPipelineType &&
    (trainingPipeline ?? '').trim() !== programPipelineType.trim()
  ) {
    return false
  }

  return !isTrainingEventEnded(schedule, now)
}
