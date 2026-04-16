import OpenAI from 'openai'
import type { LLMConfig } from '@/types'

export function createClient(config: LLMConfig): OpenAI {
  let baseURL = config.baseUrl.trim()
  if (!baseURL.startsWith('http')) {
    if (!baseURL.startsWith('/')) baseURL = `/${baseURL}`
    baseURL = `${window.location.origin}${baseURL}`
  }

  return new OpenAI({
    baseURL,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    timeout: undefined,
  })
}
