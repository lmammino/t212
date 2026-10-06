import type { WritableLike } from '../runtime.ts'

export type GuardedWritable = WritableLike & {
  /** The first error the underlying stream reported, if any. */
  failure(): Error | undefined
}

type NodeWritable = {
  on(event: 'error', listener: (error: Error) => void): unknown
  write(chunk: string | Uint8Array, callback?: (error?: Error | null) => void): boolean
}

/**
 * Wraps a Node stream so its errors never become uncaught exceptions.
 *
 * The first error (typically `EPIPE` when the reader closes early) is recorded and handed
 * to every later write callback without touching the stream again, so streaming commands
 * stop instead of crashing and `runCli` can decide how to exit.
 */
export function createGuardedWritable(stream: NodeWritable): GuardedWritable {
  let failure: Error | undefined

  stream.on('error', (error) => {
    failure ??= error
  })

  return {
    failure: () => failure,
    write(chunk, callback) {
      if (failure !== undefined) {
        callback?.(failure)
        return false
      }

      return stream.write(chunk, (error) => {
        if (error) {
          failure ??= error
        }

        callback?.(error ?? null)
      })
    },
  }
}
