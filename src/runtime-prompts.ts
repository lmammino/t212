export type EndableInput = {
  readonly readableEnded: boolean
  off(event: 'end', listener: () => void): unknown
  once(event: 'end', listener: () => void): unknown
}

/**
 * Runs an interactive prompt that is cancelled as soon as `input` ends.
 *
 * Inquirer does not settle a pending prompt when stdin reaches EOF (e.g. `t212 login <
 * /dev/null`): the event loop drains, Node warns about an unsettled top-level await, and
 * the prompt only rejects from an exit hook. Aborting on `end` makes the prompt reject
 * immediately, and the rejection is normalised to an `ExitPromptError`-named error so
 * callers handle EOF the same way as a force-closed prompt.
 */
export async function runPromptUntilInputEnds<T>(
  input: EndableInput,
  prompt: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()

  if (input.readableEnded) {
    abort()
  } else {
    input.once('end', abort)
  }

  try {
    return await prompt(controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw createExitPromptError()
    }

    throw error
  } finally {
    input.off('end', abort)
  }
}

function createExitPromptError(): Error {
  const error = new Error('The prompt was closed because input ended')
  error.name = 'ExitPromptError'
  return error
}
