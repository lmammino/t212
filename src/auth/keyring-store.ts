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

      throw toCredentialStoreError(error)
    }
  }

  async get(account: string): Promise<string | null> {
    try {
      return new Entry(credentialService, account).getPassword() ?? null
    } catch (error) {
      if (isMissingSecretError(error)) {
        return null
      }

      throw toCredentialStoreError(error)
    }
  }

  async set(account: string, secret: string): Promise<void> {
    try {
      new Entry(credentialService, account).setPassword(secret)
    } catch (error) {
      throw toCredentialStoreError(error)
    }
  }
}

function isMissingSecretError(error: unknown): boolean {
  return /not found|no entry|no matching|missing/i.test(String(error))
}

function toCredentialStoreError(error: unknown): CliError {
  return new CliError('Could not access the OS credential store', {
    code: 'credential_store_error',
    details: String(error),
    exitCode: 1,
  })
}
