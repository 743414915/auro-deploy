/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface LogEntry {
  type: 'info' | 'success' | 'error' | 'warn'
  message: string
  time: string
}

interface ProgressData {
  step: string
  status: 'running' | 'done' | 'error' | 'pending'
}

interface DeployResult {
  version?: string
  commit?: string
  message?: string
  branch?: string
  remotePath?: string
  error?: string
}

interface DeployEvent {
  type: 'log' | 'progress' | 'done'
  data: LogEntry | ProgressData | { success: boolean; info: DeployResult }
}

interface TestResult {
  success: boolean
  data?: string
  error?: string
  logs?: Array<{ message: string; type: string; time: string }>
}

interface Window {
  api: {
    getConfigPath: () => Promise<string>,
    selectConfigFile: () => Promise<string | null>,
    loadConfig: (configPath?: string) => Promise<{ success: boolean; data?: any; error?: string }>
    saveConfig: (configPath: string, config: any) => Promise<{ success: boolean; error?: string }>
    testGitConnection: (configPath?: string) => Promise<TestResult>
    testSshConnection: (configPath?: string) => Promise<TestResult>
    testDeployPath: (configPath?: string) => Promise<TestResult>
    startDeploy: (configPath?: string, branch?: string, tag?: string) => Promise<{ success: boolean; error?: string }>
    listVersions: (configPath?: string) => Promise<{ success: boolean; data?: { versions: string[]; current: string }; error?: string }>
    rollback: (configPath?: string, version?: string) => Promise<{ success: boolean; error?: string }>
    onDeployEvent: (callback: (event: DeployEvent) => void) => void
    removeDeployListener: () => void
    onTestLog: (callback: (data: { message: string; type: string }) => void) => void
    removeTestLogListener: () => void
  }
}
