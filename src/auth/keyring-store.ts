import { Entry } from '@napi-rs/keyring'
import { CliError } from '../errors.ts'
import { credentialService, type SecretStore } from './secret-store.ts'

export class KeyringSecretStore implements SecretStore {
  async delete(account: string): Promise<boolean> {
    try {
      new Entry(credentialService, account).deletePassword()
      return true
    } catch (error) {
      if (isMissingSecretError(error)) {
        return false
      }

      throw toCredentialStoreError()
    }
  }

  async get(account: string): Promise<string | null> {
    try {
      return new Entry(credentialService, account).getPassword() ?? null
    } catch (error) {
      if (isMissingSecretError(error)) {
        return null
      }

      throw toCredentialStoreError()
    }
  }

  async set(account: string, secret: string): Promise<void> {
    try {
      new Entry(credentialService, account).setPassword(secret)
    } catch {
      throw toCredentialStoreError()
    }
  }
}

function isMissingSecretError(error: unknown): boolean {
  return /not found|no entry|no matching|missing/i.test(String(error))
}

// The raw keyring error is intentionally dropped: platform credential-store errors can
// echo account names, service metadata, or other sensitive material.
function toCredentialStoreError(): CliError {
  return new CliError('Could not access the OS credential store', {
    code: 'credential_store_error',
    exitCode: 1,
  })
}
