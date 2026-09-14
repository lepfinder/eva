export interface ServiceDefinition {
  id: string
  name: string
  projectDir: string
  start: {
    command: string[]
    cwd: string
    env?: Record<string, string>
    requirePath?: string | null
  }
  preStart?: {
    when: string
    command: string[]
    cwd: string
  } | null
  pidFile: string
  logFile: string
  ports: number[]
  health: {
    url: string
    contains?: string | null
    statusOk?: boolean
    fallbackUrls?: string[]
    acceptHttpCodes?: string[]
    timeoutSecs?: number
    pollIntervalSecs?: number
  }
  openUrl: string
  stop?: {
    graceSecs?: number
    cleanupPorts?: number[]
  } | null
}

export interface CandidateConfig {
  definition: ServiceDefinition
  confidence: number
  evidence: string[]
  warnings?: string[]
  recipe?: string
}

export interface ProbeReport {
  success: boolean
  message: string
  state: string
  health: string
  ports: { port: number; listening: boolean }[]
  logTail?: string | null
  elapsedMs: number
  attempt: number
}
