const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfigPath: () => ipcRenderer.invoke('config:getPath'),
  selectConfigFile: () => ipcRenderer.invoke('config:selectFile'),
  loadConfig: (configPath) => ipcRenderer.invoke('config:load', configPath),
  saveConfig: (configPath, config) => ipcRenderer.invoke('config:save', { configPath, config }),

  // Connectivity tests (repoIndex defaults to 0 in main process)
  testGitConnection: (configPath, repoIndex) => ipcRenderer.invoke('git:test', { configPath, repoIndex }),
  testSshConnection: (configPath, repoIndex) => ipcRenderer.invoke('config:test', { configPath, repoIndex }),
  testDeployPath: (configPath, repoIndex) => ipcRenderer.invoke('deploy:testPath', { configPath, repoIndex }),

  // Branch & tag listing
  fetchBranches: (configPath, repoIndex) => ipcRenderer.invoke('git:branches', { configPath, repoIndex }),
  fetchTags: (configPath, repoIndex) => ipcRenderer.invoke('git:tags', { configPath, repoIndex }),

  // Deploy
  startDeploy: (configPath, repoIndex, branch, tag) =>
    ipcRenderer.invoke('deploy:start', { configPath, repoIndex, branch, tag }),
  simulateDeploy: (configPath, repoIndex, branch, tag) =>
    ipcRenderer.invoke('deploy:simulate', { configPath, repoIndex, branch, tag }),

  // Version management
  listVersions: (configPath, repoIndex) => ipcRenderer.invoke('versions:list', { configPath, repoIndex }),
  rollback: (configPath, repoIndex, version) =>
    ipcRenderer.invoke('rollback:execute', { configPath, repoIndex, version }),

  // Event listeners
  onDeployEvent: (callback) => {
    ipcRenderer.on('deploy:event', (_event, data) => callback(data));
  },
  removeDeployListener: () => {
    ipcRenderer.removeAllListeners('deploy:event');
  },
  onRollbackEvent: (callback) => {
    ipcRenderer.on('rollback:event', (_event, data) => callback(data));
  },
  removeRollbackListener: () => {
    ipcRenderer.removeAllListeners('rollback:event');
  },
});
