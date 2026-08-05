import { describe, expect, it } from 'vitest'
import { getSmsConsentConfig } from '@/lib/hubspot/config'
import {
  contactHasAssociationForTraining,
  contactHasRegistrantAssociation,
  contactHasTrainingAssociation,
  findCancelledAssociationsForTraining,
  findNonRegistrantAssociationsForTraining,
  findRegistrantAssociationsForTraining,
  findTrainingIdsWithActiveRegistrantAssociation,
  findTrainingIdsWithActiveSignupAssociation,
  findUnwaitlistedAssociationsForTraining,
  findWaitlistAssociationsForTraining,
  hasActiveRegistrantAssociation,
  hasCancelledAssociation,
  hasUnwaitlistedAssociation,
  isDuplicateAssociationResponse,
  mapSmsConsentToHubSpot,
  matchesAssociationLabel,
  parseTrainingAssociationRows,
} from '@/lib/hubspot/field-mappers'

describe('mapSmsConsentToHubSpot', () => {
  it('maps yes/no to HubSpot option values from config', () => {
    const { yesValue, noValue } = getSmsConsentConfig()

    expect(mapSmsConsentToHubSpot('yes')).toBe(yesValue)
    expect(mapSmsConsentToHubSpot('No')).toBe(noValue)
  })
})

describe('isDuplicateAssociationResponse', () => {
  it('detects duplicate association API errors', () => {
    expect(isDuplicateAssociationResponse({ message: 'Association already exists' }, 400)).toBe(
      true
    )
    expect(isDuplicateAssociationResponse({}, 409)).toBe(true)
    expect(isDuplicateAssociationResponse({ message: 'Not found' }, 404)).toBe(false)
  })
})

describe('parseTrainingAssociationRows', () => {
  it('parses HubSpot v3 association rows', () => {
    expect(
      parseTrainingAssociationRows([
        { id: '111', type: 'registrant' },
        { id: '222', type: 'waitlist' },
      ])
    ).toEqual([
      { trainingId: '111', associationType: 'registrant' },
      { trainingId: '222', associationType: 'waitlist' },
    ])
  })

  it('parses HubSpot v4 association rows', () => {
    expect(
      parseTrainingAssociationRows([
        {
          toObjectId: 222,
          associationTypes: [
            {
              category: 'USER_DEFINED',
              typeId: 72,
              label: 'registrant',
            },
          ],
        },
      ])
    ).toEqual([
      {
        trainingId: '222',
        associationType: 'registrant',
        associationCategory: 'USER_DEFINED',
        associationTypeId: 72,
      },
    ])
  })

  it('parses HubSpot v4 association rows with waitlist labels', () => {
    const rows = parseTrainingAssociationRows([
      {
        toObjectId: 5790939450,
        associationTypes: [{ label: 'waitlisted', category: 'USER_DEFINED', typeId: 42 }],
      },
    ])
    expect(rows).toEqual([
      {
        trainingId: '5790939450',
        associationType: 'waitlisted',
        associationCategory: 'USER_DEFINED',
        associationTypeId: 42,
      },
    ])
  })
})

describe('matchesAssociationLabel', () => {
  it('matches label or configured type id', () => {
    expect(
      matchesAssociationLabel(
        { trainingId: '1', associationType: 'registrant' },
        'registrant'
      )
    ).toBe(true)
    expect(
      matchesAssociationLabel(
        { trainingId: '1', associationTypeId: 72 },
        'registrant',
        '72'
      )
    ).toBe(true)
  })
})

describe('findRegistrantAssociationsForTraining', () => {
  it('falls back to the only legacy unlabeled association for a training', () => {
    const rows = [{ trainingId: '222', associationType: 'contact_to_training' }]
    expect(
      findRegistrantAssociationsForTraining(rows, '222', 'registrant')
    ).toEqual(rows)
  })

  it('does not treat a cancelled-only association as registrant', () => {
    const rows = [{ trainingId: '222', associationType: 'unregistered' }]
    expect(
      findRegistrantAssociationsForTraining(
        rows,
        '222',
        'registrant',
        undefined,
        'unregistered'
      )
    ).toEqual([])
  })

  it('does not treat unregistered as registrant even when cancelled label env differs', () => {
    const rows = [
      {
        trainingId: '222',
        associationType: 'unregistered',
        associationCategory: 'USER_DEFINED',
        associationTypeId: 99,
      },
    ]
    expect(findRegistrantAssociationsForTraining(rows, '222', 'registrant')).toEqual([])
  })
})

describe('findTrainingIdsWithActiveRegistrantAssociation', () => {
  it('returns every training with an active registrant association', () => {
    const rows = [
      { trainingId: '111', associationType: 'registrant' },
      { trainingId: '222', associationType: 'waitlisted' },
      { trainingId: '333', associationType: 'registrant' },
    ]

    expect(findTrainingIdsWithActiveRegistrantAssociation(rows, 'registrant')).toEqual([
      '111',
      '333',
    ])
  })
})

describe('findTrainingIdsWithActiveSignupAssociation', () => {
  it('returns trainings with registrant or waitlist associations', () => {
    const rows = [
      { trainingId: '111', associationType: 'registrant' },
      { trainingId: '222', associationType: 'waitlisted' },
      { trainingId: '333', associationType: 'unregistered' },
      { trainingId: '444', associationType: 'unwaitlisted' },
    ]

    expect(
      findTrainingIdsWithActiveSignupAssociation(rows, 'registrant', 'waitlisted')
    ).toEqual(['111', '222'])
  })
})

describe('findWaitlistAssociationsForTraining', () => {
  it('returns waitlist label rows for a training', () => {
    const rows = [
      { trainingId: '222', associationType: 'registrant' },
      { trainingId: '222', associationType: 'waitlisted' },
    ]
    expect(findWaitlistAssociationsForTraining(rows, '222', 'waitlisted')).toEqual([
      { trainingId: '222', associationType: 'waitlisted' },
    ])
  })
})

describe('hasUnwaitlistedAssociation', () => {
  it('detects unwaitlisted label associations', () => {
    expect(
      hasUnwaitlistedAssociation(
        [{ trainingId: '1', associationType: 'unwaitlisted' }],
        '1',
        'unwaitlisted'
      )
    ).toBe(true)
  })
})

describe('findCancelledAssociationsForTraining', () => {
  it('returns cancelled label rows for a training', () => {
    const rows = [
      { trainingId: '222', associationType: 'registrant' },
      { trainingId: '222', associationType: 'unregistered' },
    ]
    expect(
      findCancelledAssociationsForTraining(rows, '222', 'unregistered')
    ).toEqual([{ trainingId: '222', associationType: 'unregistered' }])
  })
})

describe('findUnwaitlistedAssociationsForTraining', () => {
  it('returns unwaitlisted label rows for a training', () => {
    const rows = [
      { trainingId: '222', associationType: 'waitlisted' },
      { trainingId: '222', associationType: 'unwaitlisted' },
    ]
    expect(
      findUnwaitlistedAssociationsForTraining(rows, '222', 'unwaitlisted')
    ).toEqual([{ trainingId: '222', associationType: 'unwaitlisted' }])
  })
})

describe('hasActiveRegistrantAssociation', () => {
  it('returns true only for explicit registrant labels', () => {
    const rows = [
      { trainingId: '222', associationType: 'unregistered' },
      { trainingId: '222', associationType: 'registrant' },
    ]
    expect(hasActiveRegistrantAssociation(rows, '222', 'registrant')).toBe(true)

    expect(
      hasActiveRegistrantAssociation(
        [{ trainingId: '222', associationType: 'unregistered' }],
        '222',
        'registrant'
      )
    ).toBe(false)
  })
})

describe('findNonRegistrantAssociationsForTraining', () => {
  it('returns every non-registrant association for a training', () => {
    const rows = [
      { trainingId: '222', associationType: 'registrant' },
      { trainingId: '222', associationType: 'unregistered' },
    ]
    expect(findNonRegistrantAssociationsForTraining(rows, '222', 'registrant')).toEqual([
      { trainingId: '222', associationType: 'unregistered' },
    ])
  })
})

describe('hasCancelledAssociation', () => {
  it('detects cancelled label associations', () => {
    expect(
      hasCancelledAssociation(
        [{ trainingId: '1', associationType: 'cancelled_registration' }],
        '1',
        'cancelled_registration'
      )
    ).toBe(true)
  })
})

describe('contactHasTrainingAssociation', () => {
  it('returns true when training id is in association results', () => {
    expect(
      contactHasTrainingAssociation([{ id: '111' }, { id: '222' }], '222')
    ).toBe(true)
    expect(contactHasTrainingAssociation([{ id: '111' }], '222')).toBe(false)
  })

  it('filters by association type when provided', () => {
    expect(
      contactHasTrainingAssociation(
        [
          { id: '222', type: 'waitlist' },
          { id: '222', type: 'registrant' },
        ],
        '222',
        'registrant'
      )
    ).toBe(true)
    expect(
      contactHasTrainingAssociation([{ id: '222', type: 'waitlist' }], '222', 'registrant')
    ).toBe(false)
  })
})

describe('contactHasRegistrantAssociation', () => {
  it('checks registrant label only', () => {
    expect(
      contactHasRegistrantAssociation(
        [{ id: '1', type: 'registrant' }],
        '1',
        'registrant'
      )
    ).toBe(true)
  })
})

describe('contactHasAssociationForTraining', () => {
  it('matches association labels case-insensitively', () => {
    const rows = parseTrainingAssociationRows([
      {
        toObjectId: '222',
        associationTypes: [{ label: 'Waitlisted', typeId: 7 }],
      },
    ])
    expect(contactHasAssociationForTraining(rows, '222', 'waitlisted')).toBe(true)
    expect(contactHasAssociationForTraining(rows, '222', 'registrant')).toBe(false)
  })

  it('matches by configured type id when label differs', () => {
    const rows = parseTrainingAssociationRows([
      {
        toObjectId: '222',
        associationTypes: [{ label: 'custom', typeId: 99 }],
      },
    ])
    expect(contactHasAssociationForTraining(rows, '222', 'waitlisted', '99')).toBe(true)
  })
})
