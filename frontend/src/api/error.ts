export function getApiErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: unknown }).response === 'object' &&
    (error as { response?: unknown }).response !== null
  ) {
    const data = ((error as { response: { data?: unknown } }).response).data
    if (
      typeof data === 'object' &&
      data !== null &&
      'detail' in data &&
      typeof (data as { detail?: unknown }).detail === 'string'
    ) {
      return (data as { detail: string }).detail
    }
  }

  return fallback
}
