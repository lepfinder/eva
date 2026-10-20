import { invoke } from '@tauri-apps/api/core'

export interface MutagenEndpoint {
  protocol?: string
  user?: string
  host?: string
  port?: number
  path?: string
  connected?: boolean
  scanned?: boolean
  directories?: number
  files?: number
  totalFileSize?: number
}

export interface MutagenIgnore {
  paths?: string[]
}

export interface MutagenSession {
  identifier: string
  name?: string
  version?: number
  creationTime?: string
  mode?: string
  alpha: MutagenEndpoint
  beta: MutagenEndpoint
  ignore?: MutagenIgnore
  paused?: boolean
  status: string
  lastError?: string
  successfulCycles?: number
}

export interface MutagenStatus {
  installed: boolean
  version?: string
  path?: string
  error?: string
}

export interface CreateSessionPayload {
  name: string
  alphaPath: string
  betaTarget: string
  syncMode?: string
  ignorePaths?: string[]
}

export interface ActionResult {
  success: boolean
  message: string
}

export const mutagenService = {
  getStatus(): Promise<MutagenStatus> {
    return invoke<MutagenStatus>('mutagen_get_status')
  },

  listSessions(): Promise<MutagenSession[]> {
    return invoke<MutagenSession[]>('mutagen_list_sessions')
  },

  createSession(payload: CreateSessionPayload): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_create_session', { payload })
  },

  pauseSession(session: string): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_pause_session', { session })
  },

  resumeSession(session: string): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_resume_session', { session })
  },

  flushSession(session: string): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_flush_session', { session })
  },

  resetSession(session: string): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_reset_session', { session })
  },

  terminateSession(session: string): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_terminate_session', { session })
  },

  testSsh(target: string): Promise<ActionResult> {
    return invoke<ActionResult>('mutagen_test_ssh', { target })
  },
}
