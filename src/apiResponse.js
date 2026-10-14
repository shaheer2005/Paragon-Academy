export async function readApiResponse(response, fallbackError) {
  const text = await response.text()
  let result

  try {
    result = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`The API returned an invalid response (HTTP ${response.status}). Make sure the API server is running and check its terminal output.`)
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`The API returned an empty response (HTTP ${response.status}). Make sure the API server is running and check its terminal output.`)
  }

  if (!response.ok) {
    throw new Error(result.error || fallbackError)
  }

  return result
}
