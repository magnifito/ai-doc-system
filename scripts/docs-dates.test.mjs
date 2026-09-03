/**
 * Tests for the shared date helpers.
 *
 * Run: node --test scripts/docs-dates.test.mjs
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { isIsoDate, today } from './docs-dates.mjs'

test('isIsoDate accepts real calendar dates only', () => {
  assert.equal(isIsoDate('2026-02-28'), true)
  assert.equal(isIsoDate('2024-02-29'), true)
  assert.equal(isIsoDate('2026-13-45'), false)
  assert.equal(isIsoDate('2026-02-30'), false)
  assert.equal(isIsoDate('2026-2-3'), false)
  assert.equal(isIsoDate('yesterday'), false)
})

test('today formats a Date as YYYY-MM-DD in UTC', () => {
  assert.equal(today(new Date('2026-09-03T23:59:00Z')), '2026-09-03')
})
