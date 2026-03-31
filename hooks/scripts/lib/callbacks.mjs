/* Array of all available callbacks */
export const ALL_CALLBACK_HANDLERS = ['getSessionSlug']

/* Callbacks are functions invoked by the server via requests in API server response */
const callbackHandlers = {
  /**
   * Looks up the session "slug" from claude's transcript jsonl file.
   * Sends slug back to server to update the UI.
   */
  getSessionSlug({ transcript_path }, { log }) {
    if (!transcript_path) {
      log.debug('getSessionSlug: no transcript_path provided')
      return null
    }
    let content
    try {
      content = readFileSync(transcript_path, 'utf8')
    } catch (err) {
      log.warn(`getSessionSlug: cannot read transcript ${transcript_path}: ${err.message}`)
      return null
    }
    let pos = 0
    while (pos < content.length) {
      const nextNewline = content.indexOf('\n', pos)
      const end = nextNewline === -1 ? content.length : nextNewline
      const line = content.slice(pos, end).trim()
      pos = end + 1
      if (!line || !line.includes('"slug"')) continue
      try {
        const entry = JSON.parse(line)
        if (entry.slug) {
          log.debug(`getSessionSlug: found slug="${entry.slug}"`)
          return { slug: entry.slug }
        }
      } catch {
        continue
      }
    }
    log.debug(`getSessionSlug: no slug found in ${transcript_path}`)
    return null
  },
}

/**
 * Handle callback requests from server
 *
 * @param {Array} requests
 * @param {Opts} param1
 * @returns
 */
export async function handleCallbackRequests(requests, { config, log }) {
  if (!Array.isArray(requests)) {
    log.warn(`Invalid requests type '${typeof requests}', requests must be an array`)
    return
  }
  log.debug(`Processing ${requests.length} callback request(s)`)

  const allowedCallbacks = config.allowedCallbacks

  for (const req of requests) {
    log.trace(
      `Callback request: cmd=${req.cmd} callback=${req.callback || 'none'} args=${JSON.stringify(
        req.args || {},
      )}`,
    )

    if (allowedCallbacks && !allowedCallbacks.has(req.cmd)) {
      log.warn(`Blocked callback: ${req.cmd} (not in AGENTS_OBSERVE_ALLOW_LOCAL_CALLBACKS)`)
      continue
    }

    const handler = callbackHandlers[req.cmd]

    if (!handler) {
      log.warn(`No handler for callback: ${req.cmd}`)
      continue
    }

    const result = handler(req.args || {}, { config, log })

    log.debug(`Callback ${req.cmd} result: ${JSON.stringify(result)}`)

    if (result && req.callback) {
      const callbackUrl = `${config.baseOrigin}${req.callback}`
      log.debug(`Posting callback response to ${callbackUrl}`)

      const resp = await postJson(callbackUrl, result)
      log.trace(`Callback response status: ${resp.status}`)
    }
  }
}
