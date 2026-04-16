import OpenAI from 'openai'
import type { LLMConfig } from '@/types'

export function createClient(config: LLMConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    timeout: undefined,
  })
}
