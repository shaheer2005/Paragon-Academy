import assert from 'node:assert/strict'
import test from 'node:test'
import { readApiResponse } from '../src/apiResponse.js'

test('reads a successful JSON API response', async () => {
  const response = new Response(JSON.stringify({ user: { role: 'student' } }), { status: 200 })
  assert.deepEqual(await readApiResponse(response, 'Fallback'), { user: { role: 'student' } })
})

test('preserves JSON errors from the API', async () => {
  const response = new Response(JSON.stringify({ error: 'Email or password is incorrect.' }), { status: 401 })
  await assert.rejects(readApiResponse(response, 'Fallback'), {
    message: 'Email or password is incorrect.',
  })
})

test('explains how to recover from an empty API response', async () => {
  const response = new Response(null, { status: 502 })
  await assert.rejects(readApiResponse(response, 'Fallback'), {
    message: /empty response.*API server is running/i,
  })
})

test('handles non-JSON API responses without exposing a parse error', async () => {
  const response = new Response('<!doctype html>', { status: 502 })
  await assert.rejects(readApiResponse(response, 'Fallback'), {
    message: /invalid response.*API server is running/i,
  })
})
