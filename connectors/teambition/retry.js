export const LOGIN_ATTEMPTS = 3
export const LOGIN_TIMEOUT_MS = 45_000
export const ATTEMPT_TIMEOUT_MS = 12_000

export function httpStatus(error) {
  for (const value of [error?.status, error?.statusCode, error?.code, error?.cause?.status, error?.cause?.statusCode]) {
    const status = Number(value)
    if (Number.isInteger(status) && status >= 400 && status < 600) return status
  }
  return null
}
export function isCertificateError(error) {
  return /CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY/.test(String(error?.cause?.code || error?.code || ''))
}
export function isTransientError(error) {
  if (isCertificateError(error)) return false
  const status = httpStatus(error)
  if (status) return [408, 429, 500, 502, 503, 504].includes(status)
  if (error?.name === 'TimeoutError' || error?.code === -32001) return true
  const text = [error?.message, error?.cause?.message, error?.cause?.code, error?.code].filter(Boolean).join(' ')
  return /network error|upstream error|do request failed|fetch failed|socket|timed?\s*out|timeout|econn(?:reset|refused|aborted)|enotfound|eai_again|enetunreach|ehostunreach|terminated|connection (?:closed|reset)|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)/i.test(text)
}
export async function waitForRetry(delay, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, delay)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
// SDK request cancellation does not necessarily interrupt an in-flight transport POST.
// Race the complete attempt and close that attempt's client before retrying.
export function withSignal(operation, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const settle = (fn, value) => { signal.removeEventListener('abort', abort); fn(value) }
    const abort = () => settle(reject, signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation() }).then((value) => settle(resolve, value), (error) => settle(reject, error))
  })
}
export function attemptDeadline(parent, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController()
  const abort = () => controller.abort(parent.reason)
  parent.addEventListener('abort', abort, { once: true })
  if (parent.aborted) abort()
  const timer = setTimeout(() => controller.abort(new DOMException('MCP attempt timeout', 'TimeoutError')), timeoutMs)
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent.removeEventListener('abort', abort) } }
}
