export const credentialAccounts = {
  apiKey: 'api-key',
  apiSecret: 'api-secret',
} as const

export const credentialService = 't212-cli'

export type SecretStore = {
  delete(account: string): Promise<boolean>
  get(account: string): Promise<string | null>
  set(account: string, secret: string): Promise<void>
}
