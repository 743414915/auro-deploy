const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');

let mainWindow = null;
let deploying = false;

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  try {
    dialog.showErrorBox('应用启动错误', err.stack || err.message);
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'Auto Deploy',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Page load failed:', errorCode, errorDescription);
  });
}

app.whenReady().then(() => {
  // Auto-create default config if missing
  const defaultConfigPath = getDefaultConfigPath();
  if (!fs.existsSync(defaultConfigPath)) {
    try {
      const defaultCfg = {
        repos: [{
          name: '默认仓库',
          git: { url: '', branch: 'main', cloneDir: './.deploy-cache', username: '', token: '' },
          build: { command: 'npm run build', outputDir: 'dist' },
          server: { host: '', port: 22, username: 'root', password: '', privateKey: '' },
          deploy: { remotePath: '', backupKeep: 5, preDeployCommands: [], postDeployCommands: ['nginx -s reload'], preDeployFiles: [] },
        }],
      };
      fsExtra.writeJsonSync(defaultConfigPath, defaultCfg, { spaces: 2 });
    } catch (_) {}
  }

  try {
    createWindow();
  } catch (err) {
    dialog.showErrorBox('窗口创建失败', err.stack || err.message);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========== Config path helper ==========

function getDefaultConfigPath() {
  return path.join(path.dirname(app.getPath('exe')), 'deploy.config.json');
}

// ========== Lazy-load helpers ==========

function loadConfigModule() {
  return require('../src/config');
}

function loadSshModule() {
  return require('../src/ssh');
}

function loadGitModule() {
  return require('../src/git');
}

function loadBuildModule() {
  return require('../src/build');
}

function send(win, channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

/** Resolve repoIndex to a valid number, default 0 */
function resolveRepoIndex(repoIndex) {
  return (repoIndex !== undefined && repoIndex !== null) ? repoIndex : 0;
}

// ========== IPC Handlers ==========

ipcMain.handle('config:getPath', async () => {
  return getDefaultConfigPath();
});

ipcMain.handle('config:selectFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择配置文件',
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
    properties: ['openFile'],
    defaultPath: getDefaultConfigPath(),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---- Config CRUD ----

ipcMain.handle('config:load', async (_event, configPath) => {
  try {
    const { load } = loadConfigModule();
    const config = load(configPath || getDefaultConfigPath());
    return { success: true, data: config };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config:save', async (_event, { configPath, config }) => {
  try {
    const targetPath = configPath || getDefaultConfigPath();
    const fsExtra = require('fs-extra');
    fsExtra.writeJsonSync(targetPath, config, { spaces: 2 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- Connectivity tests ----

ipcMain.handle('git:test', async (_event, { configPath, repoIndex }) => {
  const logs = [];
  function log(msg, type) { logs.push({ message: msg, type, time: new Date().toISOString() }); }
  try {
    log('正在测试 Git 仓库连接...', 'info');
    const targetPath = configPath || getDefaultConfigPath();
    log(`配置文件: ${targetPath}`, 'info');

    const fs = require('fs');
    const fsExtra = require('fs-extra');
    if (!fs.existsSync(targetPath)) {
      throw new Error(`配置文件不存在: ${targetPath}`);
    }

    let raw;
    try {
      raw = fsExtra.readJsonSync(targetPath);
    } catch (parseErr) {
      throw new Error(`配置文件 JSON 解析失败: ${parseErr.message}`);
    }

    const { load, getRepo } = loadConfigModule();
    const config = load(targetPath);
    const repo = getRepo(config, resolveRepoIndex(repoIndex));

    log(`仓库: ${repo.git.url}`, 'info');
    if (repo.git.username) {
      log(`认证用户: ${repo.git.username}`, 'info');
    } else if (repo.git.url.startsWith('git@')) {
      log('使用 SSH 密钥认证', 'info');
    } else {
      log('未提供认证信息（HTTPS 需要用户名和 Token）', 'info');
    }

    log('执行: git ls-remote ...', 'info');
    const { testConnection } = loadGitModule();
    await testConnection(repo);
    log('Git 仓库连接成功 ✓', 'success');
    return { success: true, logs };
  } catch (err) {
    log(`失败: ${err.message}`, 'error');
    return { success: false, error: err.message, logs };
  }
});

ipcMain.handle('git:branches', async (_event, { configPath, repoIndex }) => {
  try {
    const { load, getRepo } = loadConfigModule();
    const config = load(configPath || getDefaultConfigPath());
    const repo = getRepo(config, resolveRepoIndex(repoIndex));
    const { fetchBranches } = loadGitModule();
    const branches = await fetchBranches(repo);
    return { success: true, data: branches };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('git:tags', async (_event, { configPath, repoIndex }) => {
  try {
    const { load, getRepo } = loadConfigModule();
    const config = load(configPath || getDefaultConfigPath());
    const repo = getRepo(config, resolveRepoIndex(repoIndex));
    const { fetchTags } = loadGitModule();
    const tags = await fetchTags(repo);
    return { success: true, data: tags };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config:test', async (_event, { configPath, repoIndex }) => {
  const logs = [];
  function log(msg, type) { logs.push({ message: msg, type, time: new Date().toISOString() }); }
  try {
    log('正在测试 SSH 连接...', 'info');
    const { load, getRepo } = loadConfigModule();
    const config = load(configPath || getDefaultConfigPath());
    const repo = getRepo(config, resolveRepoIndex(repoIndex));
    log(`目标: ${repo.server.username}@${repo.server.host}:${repo.server.port}`, 'info');
    log(`认证方式: ${repo.server.privateKey ? 'SSH 密钥' : '密码'}`, 'info');
    const { SSHClient } = loadSshModule();
    const ssh = new SSHClient(repo);
    await ssh.connect();
    log('SSH 连接成功 ✓', 'success');
    const result = await ssh.exec('echo ok');
    ssh.disconnect();
    return { success: true, data: result, logs };
  } catch (err) {
    log(`失败: ${err.message}`, 'error');
    return { success: false, error: err.message, logs };
  }
});

ipcMain.handle('deploy:testPath', async (_event, { configPath, repoIndex }) => {
  const logs = [];
  function log(msg, type) { logs.push({ message: msg, type, time: new Date().toISOString() }); }
  try {
    log('正在测试部署路径...', 'info');
    const { load, getRepo } = loadConfigModule();
    const { SSHClient } = loadSshModule();
    const config = load(configPath || getDefaultConfigPath());
    const repo = getRepo(config, resolveRepoIndex(repoIndex));
    log(`检查路径: ${repo.deploy.remotePath}`, 'info');
    const ssh = new SSHClient(repo);
    await ssh.connect();
    log('SSH 已连接，检查路径状态...', 'info');
    const result = await ssh.exec(
      `test -d "${repo.deploy.remotePath}" && echo "EXISTS" || echo "MISSING"; test -w "${repo.deploy.remotePath}" && echo "WRITABLE" || echo "READONLY"`
    );
    ssh.disconnect();
    const exists = result.includes('EXISTS');
    const writable = result.includes('WRITABLE');
    let msg = '';
    if (!exists) msg = `路径不存在: ${repo.deploy.remotePath}`;
    else if (!writable) msg = `路径存在但不可写: ${repo.deploy.remotePath}`;
    else msg = `路径正常: ${repo.deploy.remotePath}`;
    log(msg, exists && writable ? 'success' : 'error');
    return { success: exists && writable, error: exists && !writable ? msg : undefined, data: msg, logs };
  } catch (err) {
    log(`失败: ${err.message}`, 'error');
    return { success: false, error: err.message, logs };
  }
});

// ---- Versions & Rollback ----

ipcMain.handle('versions:list', async (_event, { configPath, repoIndex }) => {
  try {
    const { load, getRepo } = loadConfigModule();
    const { SSHClient } = loadSshModule();
    const config = load(configPath || getDefaultConfigPath());
    const repo = getRepo(config, resolveRepoIndex(repoIndex));
    const ssh = new SSHClient(repo);
    await ssh.connect();

    const remotePathQ = `"${repo.deploy.remotePath}"`;
    const listResult = await ssh.exec(
      `ls -1 ${remotePathQ}/.backup/ | sort -r`
    );
    const versions = listResult.split('\n').filter(Boolean)
      .filter((f) => f.endsWith('.tar.gz'))
      .map((f) => f.replace('.tar.gz', ''));

    // Read current marker
    let current = null;
    try {
      const marker = await ssh.exec(`cat ${remotePathQ}/.backup/.current 2>/dev/null || echo ""`);
      current = marker.trim();
    } catch (_) {}

    ssh.disconnect();
    return { success: true, data: { versions, current } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('rollback:execute', async (event, { configPath, repoIndex, version }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  function rlog(type, message) {
    send(win, 'rollback:event', { type: 'log', data: { type, message, time: new Date().toISOString() } });
  }
  try {
    rlog('info', `准备回滚到: ${version}`);
    const { load, getRepo } = loadConfigModule();
    const { SSHClient } = loadSshModule();
    const config = load(configPath || getDefaultConfigPath());
    const repo = getRepo(config, resolveRepoIndex(repoIndex));

    rlog('info', `连接 ${repo.server.host}:${repo.server.port} ...`);
    const ssh = new SSHClient(repo);
    await ssh.connect();
    rlog('success', 'SSH 连接成功');

    const backupFile = `"${repo.deploy.remotePath}/.backup/${version}.tar.gz"`;
    const remotePath = `"${repo.deploy.remotePath}"`;
    try {
      await ssh.exec(`test -f ${backupFile}`);
    } catch {
      ssh.disconnect();
      rlog('error', `备份不存在: ${version}`);
      send(win, 'rollback:event', { type: 'done', data: { success: false, error: `备份不存在: ${version}` } });
      return { success: false, error: `备份不存在: ${version}` };
    }
    rlog('info', '备份文件存在，开始恢复...');

    rlog('info', '清空当前文件...');
    await ssh.exec(`rm -rf "${repo.deploy.remotePath}/"*`);
    rlog('info', '检查备份文件...');
    const backupInfo = await ssh.exec(`ls -lh ${backupFile} 2>&1 || echo "NOT_FOUND"`);
    rlog('info', `备份: ${backupInfo.trim()}`);
    if (backupInfo.includes('NOT_FOUND') || backupInfo.includes(' 0 ')) {
      throw new Error(`备份文件无效: ${backupInfo.trim()}`);
    }
    rlog('info', '解压备份文件...');
    const tarResult = await ssh.exec(`tar -xzvf ${backupFile} -C ${remotePath} 2>&1`);
    rlog('info', tarResult || '(无输出)');
    // Verify files were restored
    const verifyResult = await ssh.exec(`ls -A ${remotePath} 2>&1 | head -10 || echo "EMPTY"`);
    rlog('info', `恢复后文件: ${verifyResult.trim()}`);
    if (verifyResult.includes('EMPTY') || !verifyResult.trim()) {
      throw new Error('恢复后目录为空，备份可能损坏');
    }
    rlog('success', '文件恢复完成');

    // Mark current version
    await ssh.exec(`echo "${version}" > ${remotePath}/.backup/.current`);

    if (repo.deploy.postDeployCommands && repo.deploy.postDeployCommands.length > 0) {
      for (const cmd of repo.deploy.postDeployCommands) {
        rlog('info', `执行: ${cmd}`);
        const out = await ssh.exec(cmd);
        if (out) rlog('info', out);
      }
    }

    ssh.disconnect();
    rlog('success', '回滚成功!');
    send(win, 'rollback:event', { type: 'done', data: { success: true, version } });
    return { success: true };
  } catch (err) {
    const errMsg = err.message || String(err);
    rlog('error', errMsg);
    send(win, 'rollback:event', { type: 'done', data: { success: false, error: errMsg } });
    return { success: false, error: errMsg };
  }
});

// ---- Full Deploy Pipeline ----

ipcMain.handle('deploy:start', async (event, { configPath, repoIndex, branch, tag }) => {
  if (deploying) {
    return { success: false, error: '已有部署任务正在进行中' };
  }
  deploying = true;

  const win = BrowserWindow.fromWebContents(event.sender);

  function log(type, message) {
    send(win, 'deploy:event', { type: 'log', data: { type, message, time: new Date().toISOString() } });
  }

  function progress(step, status) {
    send(win, 'deploy:event', { type: 'progress', data: { step, status } });
  }

  function done(success, info) {
    send(win, 'deploy:event', { type: 'done', data: { success, info } });
  }

  try {
    const { load, getRepo } = loadConfigModule();
    const { checkout } = loadGitModule();
    const { SSHClient } = loadSshModule();

    const configPathResolved = configPath || getDefaultConfigPath();
    log('info', `加载配置: ${configPathResolved}`);
    const config = load(configPathResolved);
    const repo = getRepo(config, resolveRepoIndex(repoIndex));

    if (branch) repo.git.branch = branch;
    if (tag) repo.git.tag = tag;

    // Step 1: Git checkout
    progress('拉取代码', 'running');
    log('info', `Git 仓库: ${repo.git.url}`);
    log('info', `目标: ${tag ? 'tag:' + tag : 'branch:' + repo.git.branch}`);
    const commit = await checkout(repo);
    progress('拉取代码', 'done');

    // Step 2: Build
    progress('构建项目', 'running');
    log('info', `构建命令: ${repo.build.command}`);
    const { run: runBuild } = loadBuildModule();
    await runBuild(repo, (text) => log('info', text.trimEnd()));
    progress('构建项目', 'done');

    // Write pre-deploy file overrides
    if (repo.deploy.preDeployFiles && repo.deploy.preDeployFiles.length > 0) {
      const buildDir = path.resolve(repo.git.cloneDir, repo.build.outputDir);
      for (const f of repo.deploy.preDeployFiles) {
        if (!f.path) continue;
        const targetFile = path.resolve(buildDir, f.path);
        fsExtra.ensureDirSync(path.dirname(targetFile));
        fsExtra.writeFileSync(targetFile, f.content || '', 'utf8');
        log('info', `已覆盖文件: ${f.path}`);
      }
    }

    // Step 3: Compress
    progress('压缩产物', 'running');
    const version = `v${formatDateTime()}_${commit.hash}`;
    const buildDir = path.resolve(repo.git.cloneDir, repo.build.outputDir);
    const localArchive = path.resolve(repo.git.cloneDir, '..', `deploy_${version}.tar.gz`);

    log('info', `构建产物目录: ${buildDir}`);
    log('info', `压缩目标文件: ${localArchive}`);

    if (!fsExtra.existsSync(buildDir)) {
      progress('压缩产物', 'error');
      throw new Error(`构建产物目录不存在: ${buildDir}\n请检查构建命令和 outputDir 配置`);
    }

    const dirFiles = fsExtra.readdirSync(buildDir);
    log('info', `产物文件数: ${dirFiles.length}`);
    if (dirFiles.length === 0) {
      progress('压缩产物', 'error');
      throw new Error(`构建产物目录为空: ${buildDir}`);
    }

    const size = await compressDir(buildDir, localArchive, (text) => log('info', text));
    log('info', `压缩完成: ${(size / 1024 / 1024).toFixed(2)} MB`);
    progress('压缩产物', 'done');

    // Step 4: SSH Connect
    progress('连接服务器', 'running');
    const ssh = new SSHClient(repo);
    await ssh.connect();
    log('info', 'SSH 连接成功');
    progress('连接服务器', 'done');

    // Step 5: Backup existing files (skip if first deploy)
    progress('备份旧文件', 'running');
    const remotePathQ = `"${repo.deploy.remotePath}"`;
    const backupFile = `${remotePathQ}/.backup/${version}.tar.gz`;
    // Check if remote path has any files (excluding .backup)
    const hasFiles = await ssh.exec(
      `ls -A ${remotePathQ} | grep -v '^\\.backup$' | head -1 || echo "EMPTY"`
    );
    if (!hasFiles.includes('EMPTY')) {
      await ssh.exec(`mkdir -p ${remotePathQ}/.backup`);
      await ssh.exec(
        `tar -czf ${backupFile} --exclude=.backup -C ${remotePathQ} .`
      );
      // Verify backup was created
      const backupCheck = await ssh.exec(`ls -lh ${backupFile} 2>&1 || echo "FAILED"`);
      if (backupCheck.includes('FAILED') || backupCheck.includes(' 0 ')) {
        log('warn', `备份可能失败: ${backupCheck.trim()}`);
      } else {
        log('info', `备份完成: ${backupCheck.trim()}`);
      }
    } else {
      log('info', '远程目录为空，跳过备份');
    }
    progress('备份旧文件', 'done');

    // Step 6: Upload
    progress('上传文件', 'running');
    const remoteArchive = `/tmp/deploy_${version}.tar.gz`;
    await ssh.uploadFile(localArchive, remoteArchive);
    log('info', '文件上传完成');
    progress('上传文件', 'done');

    // Step 7: Pre-deploy commands
    if (repo.deploy.preDeployCommands && repo.deploy.preDeployCommands.length > 0) {
      progress('部署前脚本', 'running');
      for (const cmd of repo.deploy.preDeployCommands) {
        log('info', `执行: ${cmd}`);
        const out = await ssh.exec(cmd);
        if (out) log('info', out);
      }
      progress('部署前脚本', 'done');
    } else {
      progress('部署前脚本', 'done');
    }

    // Step 8: Deploy (clear old files, extract new)
    progress('解压部署', 'running');
    // Remove all visible files/dirs (glob * skips dotfiles like .backup)
    await ssh.exec(`rm -rf "${repo.deploy.remotePath}/"*`);
    const deployTarOut = await ssh.exec(`tar -xzvf ${remoteArchive} -C ${remotePathQ} 2>&1`);
    log('info', deployTarOut || '解压完成');
    await ssh.exec(`rm -f ${remoteArchive}`);
    log('info', '文件已部署到远程路径');
    progress('解压部署', 'done');

    // Step 9: Post-deploy commands
    if (repo.deploy.postDeployCommands && repo.deploy.postDeployCommands.length > 0) {
      progress('部署后脚本', 'running');
      for (const cmd of repo.deploy.postDeployCommands) {
        log('info', `执行: ${cmd}`);
        const out = await ssh.exec(cmd);
        if (out) log('info', out);
      }
      progress('部署后脚本', 'done');
    } else {
      progress('部署后脚本', 'done');
    }

    // Step 10: Cleanup old backups
    const listResult = await ssh.exec(`ls -1 ${remotePathQ}/.backup/ | sort -r`);
    const backups = listResult.split('\n').filter(Boolean);
    if (backups.length > repo.deploy.backupKeep) {
      const toRemove = backups.slice(repo.deploy.backupKeep);
      for (const f of toRemove) {
        await ssh.exec(`rm -f ${remotePathQ}/.backup/${f}`);
      }
      log('info', `清理 ${toRemove.length} 个旧备份`);
    }

    // Mark current version
    await ssh.exec(`echo "${version}" > ${remotePathQ}/.backup/.current`);

    ssh.disconnect();
    fsExtra.removeSync(localArchive);

    const resultInfo = {
      version,
      commit: commit.hash,
      message: commit.message,
      branch: commit.branch,
      remotePath: repo.deploy.remotePath,
    };
    log('success', '部署完成!');
    done(true, resultInfo);
    return { success: true, info: resultInfo };

  } catch (err) {
    log('error', err.message);
    done(false, { error: err.message });
    return { success: false, error: err.message };
  } finally {
    deploying = false;
  }
});

// ---- Local Simulation Deploy ----

ipcMain.handle('deploy:simulate', async (event, { configPath, repoIndex, branch, tag }) => {
  if (deploying) {
    return { success: false, error: '已有部署任务正在进行中' };
  }
  deploying = true;

  const win = BrowserWindow.fromWebContents(event.sender);

  function log(type, message) {
    send(win, 'deploy:event', { type: 'log', data: { type, message, time: new Date().toISOString() } });
  }

  function progress(step, status) {
    send(win, 'deploy:event', { type: 'progress', data: { step, status } });
  }

  function done(success, info) {
    send(win, 'deploy:event', { type: 'done', data: { success, info } });
  }

  try {
    const { load, getRepo } = loadConfigModule();
    const { checkout } = loadGitModule();

    const configPathResolved = configPath || getDefaultConfigPath();
    log('info', `[模拟模式] 加载配置: ${configPathResolved}`);
    const config = load(configPathResolved);
    const repo = getRepo(config, resolveRepoIndex(repoIndex));

    if (branch) repo.git.branch = branch;
    if (tag) repo.git.tag = tag;

    // Sanitize repo name for filesystem
    const simulateName = (repo.name || `repo-${resolveRepoIndex(repoIndex)}`).replace(/[\\/:*?"<>| ]/g, '-');
    const simulatePath = path.resolve('.deploy-simulate', simulateName);
    log('info', `[模拟模式] 部署到: ${simulatePath}`);

    // Step 1: Git checkout
    progress('拉取代码', 'running');
    log('info', `Git 仓库: ${repo.git.url}`);
    log('info', `目标: ${tag ? 'tag:' + tag : 'branch:' + repo.git.branch}`);
    const commit = await checkout(repo);
    progress('拉取代码', 'done');

    // Step 2: Build
    progress('构建项目', 'running');
    log('info', `构建命令: ${repo.build.command}`);
    const { run: runBuild } = loadBuildModule();
    await runBuild(repo, (text) => log('info', text.trimEnd()));
    progress('构建项目', 'done');

    // Write pre-deploy file overrides
    if (repo.deploy.preDeployFiles && repo.deploy.preDeployFiles.length > 0) {
      const buildDir = path.resolve(repo.git.cloneDir, repo.build.outputDir);
      for (const f of repo.deploy.preDeployFiles) {
        if (!f.path) continue;
        const targetFile = path.resolve(buildDir, f.path);
        fsExtra.ensureDirSync(path.dirname(targetFile));
        fsExtra.writeFileSync(targetFile, f.content || '', 'utf8');
        log('info', `已覆盖文件: ${f.path}`);
      }
    }

    // Step 3: Compress
    progress('压缩产物', 'running');
    const version = `v${formatDateTime()}_${commit.hash}`;
    const buildDir = path.resolve(repo.git.cloneDir, repo.build.outputDir);
    const localArchive = path.resolve(repo.git.cloneDir, '..', `deploy_${version}.tar.gz`);

    log('info', `构建产物目录: ${buildDir}`);
    log('info', `压缩目标文件: ${localArchive}`);

    if (!fsExtra.existsSync(buildDir)) {
      progress('压缩产物', 'error');
      throw new Error(`构建产物目录不存在: ${buildDir}\n请检查构建命令和 outputDir 配置`);
    }

    const dirFiles = fsExtra.readdirSync(buildDir);
    log('info', `产物文件数: ${dirFiles.length}`);
    if (dirFiles.length === 0) {
      progress('压缩产物', 'error');
      throw new Error(`构建产物目录为空: ${buildDir}`);
    }

    const size = await compressDir(buildDir, localArchive, (text) => log('info', text));
    log('info', `压缩完成: ${(size / 1024 / 1024).toFixed(2)} MB`);
    progress('压缩产物', 'done');

    // Step 4: Backup existing files in simulate dir
    progress('备份旧文件', 'running');
    if (fs.existsSync(simulatePath)) {
      const backupDir = path.join(simulatePath, '.backup');
      const backupFile = path.join(backupDir, `${version}.tar.gz`);
      // Check if dir has visible files (not just .backup)
      const entries = fs.readdirSync(simulatePath).filter((e) => e !== '.backup');
      if (entries.length > 0) {
        fsExtra.ensureDirSync(backupDir);
        // Use tar via child_process since we're local
        const { execSync } = require('child_process');
        try {
          execSync(`tar -czf "${backupFile}" --exclude=.backup -C "${simulatePath}" .`, {
            windowsHide: true,
            timeout: 60000,
          });
          log('info', `备份完成: ${version}.tar.gz`);
        } catch (tarErr) {
          log('warn', `tar 备份失败: ${tarErr.message}，跳过备份`);
        }
      } else {
        log('info', '模拟目录为空，跳过备份');
      }
    } else {
      log('info', '首次模拟，创建目录');
      fsExtra.ensureDirSync(simulatePath);
    }
    progress('备份旧文件', 'done');

    // Step 5: Deploy (extract to simulate dir)
    progress('解压部署', 'running');
    // Remove old visible files (keep .backup)
    const entries = fs.readdirSync(simulatePath).filter((e) => e !== '.backup');
    for (const entry of entries) {
      fsExtra.removeSync(path.join(simulatePath, entry));
    }
    // Extract build artifacts
    const { execSync } = require('child_process');
    execSync(`tar -xzf "${localArchive}" -C "${simulatePath}"`, {
      windowsHide: true,
      timeout: 60000,
    });
    log('info', '文件已解压到模拟目录');

    // List deployed files
    function listFiles(dir, prefix) {
      const items = fs.readdirSync(dir).filter((e) => e !== '.backup');
      for (const item of items) {
        const full = path.join(dir, item);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          log('info', `${prefix}${item}/`);
          listFiles(full, prefix + '  ');
        } else {
          const kb = (stat.size / 1024).toFixed(1);
          log('info', `${prefix}${item}  (${kb} KB)`);
        }
      }
    }
    log('info', '--- 部署文件结构 ---');
    listFiles(simulatePath, '  ');
    log('info', '--- 结束 ---');
    progress('解压部署', 'done');

    // Step 6: Cleanup old backups
    progress('清理旧备份', 'running');
    const backupDir = path.join(simulatePath, '.backup');
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir)
        .filter((f) => f.endsWith('.tar.gz'))
        .sort()
        .reverse();
      if (backups.length > repo.deploy.backupKeep) {
        const toRemove = backups.slice(repo.deploy.backupKeep);
        for (const f of toRemove) {
          fsExtra.removeSync(path.join(backupDir, f));
        }
        log('info', `清理 ${toRemove.length} 个旧备份`);
      }
    }
    progress('清理旧备份', 'done');

    // Cleanup local archive
    fsExtra.removeSync(localArchive);

    const resultInfo = {
      version,
      commit: commit.hash,
      message: commit.message,
      branch: commit.branch,
      remotePath: simulatePath,
    };
    log('success', `[模拟模式] 部署完成! 文件路径: ${simulatePath}`);
    log('info', `你可以在文件管理器中打开: ${simulatePath}`);
    done(true, resultInfo);
    return { success: true, info: resultInfo };

  } catch (err) {
    const errMsg = err.message || String(err);
    log('error', errMsg);
    done(false, { error: errMsg });
    return { success: false, error: errMsg };
  } finally {
    deploying = false;
  }
});

function formatDateTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function compressDir(sourceDir, outputPath, onLog) {
  return new Promise((resolve, reject) => {
    const fsExtra = require('fs-extra');
    if (!fsExtra.existsSync(sourceDir)) {
      reject(new Error(`压缩源目录不存在: ${sourceDir}`));
      return;
    }
    const log = onLog || (() => {});
    log('  使用 tar 压缩...');

    const { spawn } = require('child_process');
    const child = spawn('tar', ['-czf', outputPath, '-C', sourceDir, '.'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.stdout.on('data', (d) => { log(d.toString()); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`tar 压缩失败 (exit ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const size = fs.statSync(outputPath).size;
        resolve(size);
      } catch (statErr) {
        reject(new Error(`压缩文件未生成: ${statErr.message}`));
      }
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('系统中未找到 tar 命令。Windows 请安装 Git for Windows 或启用 WSL。'));
      } else {
        reject(new Error(`tar 执行失败: ${err.message}`));
      }
    });
  });
}
