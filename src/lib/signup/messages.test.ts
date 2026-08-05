import { describe, expect, it } from 'vitest'
import { signupFormContent } from '@/lib/content'
import {
  alreadyRegisteredAnotherTrainingMessage,
  isAlreadyRegisteredAnotherTrainingMessage,
} from '@/lib/signup/messages'

describe('alreadyRegisteredAnotherTrainingMessage', () => {
  it('builds the plain-text API error message', () => {
    expect(alreadyRegisteredAnotherTrainingMessage(signupFormContent.messages)).toBe(
      'You already have a registration or waitlist spot for another training session in this program. Cancel it here or find the link in your email when you signed up previously.'
    )
  })

  it('detects the composed message', () => {
    const message = alreadyRegisteredAnotherTrainingMessage(signupFormContent.messages)
    expect(isAlreadyRegisteredAnotherTrainingMessage(message, signupFormContent.messages)).toBe(true)
  })
})
