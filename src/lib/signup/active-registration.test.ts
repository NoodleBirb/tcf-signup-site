import { describe, expect, it } from 'vitest'
import { doesTrainingBlockProgramSignup } from './active-registration'

const mhfaPipeline = 'mhfa-pipeline'
const qprPipeline = 'qpr-pipeline'

describe('doesTrainingBlockProgramSignup', () => {
  it('blocks when the training is in the same program and has not ended', () => {
    expect(
      doesTrainingBlockProgramSignup({
        trainingPipeline: mhfaPipeline,
        programPipelineType: mhfaPipeline,
        schedule: { session1End: '2099-06-10T21:00:00.000Z' },
        now: new Date('2026-06-01T12:00:00.000Z'),
      })
    ).toBe(true)
  })

  it('does not block trainings in a different program', () => {
    expect(
      doesTrainingBlockProgramSignup({
        trainingPipeline: qprPipeline,
        programPipelineType: mhfaPipeline,
        schedule: { session1End: '2099-06-10T21:00:00.000Z' },
        now: new Date('2026-06-01T12:00:00.000Z'),
      })
    ).toBe(false)
  })

  it('does not block after day 1 end when there is no day 2', () => {
    expect(
      doesTrainingBlockProgramSignup({
        trainingPipeline: mhfaPipeline,
        programPipelineType: mhfaPipeline,
        schedule: { session1End: '2026-06-10T21:00:00.000Z' },
        now: new Date('2026-06-10T21:00:01.000Z'),
      })
    ).toBe(false)
  })

  it('uses day 2 end when present', () => {
    expect(
      doesTrainingBlockProgramSignup({
        trainingPipeline: mhfaPipeline,
        programPipelineType: mhfaPipeline,
        schedule: {
          session1End: '2026-06-10T21:00:00.000Z',
          session2End: '2026-06-11T21:00:00.000Z',
        },
        now: new Date('2026-06-11T12:00:00.000Z'),
      })
    ).toBe(true)

    expect(
      doesTrainingBlockProgramSignup({
        trainingPipeline: mhfaPipeline,
        programPipelineType: mhfaPipeline,
        schedule: {
          session1End: '2026-06-10T21:00:00.000Z',
          session2End: '2026-06-11T21:00:00.000Z',
        },
        now: new Date('2026-06-11T21:00:01.000Z'),
      })
    ).toBe(false)
  })
})
