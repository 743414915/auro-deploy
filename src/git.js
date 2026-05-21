const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');
const { spawn, execSync } = require('child_process');

function buildAuthUrl(url, username, token) {
  if (!username || !token) return url;
  if (url.startsWith('https://')) {
    const u = new URL(url);
    u.username = encodeURIComponent(username);
    u.password = encodeURIComponent(token);
    return u.toString();
  }
  return url;
}

function killProcess(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  if (process.platform === 'win32') {
    try { execSync(`taskkill /F /T /PID ${pid} 2>nul`, { stdio: 'ignore' }); } catch (_) {}
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }
}

async function testConnection(config) {
  const { url, username, token } = config.git;
  const authUrl = buildAuthUrl(url, username, token);

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['ls-remote', authUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=8',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killProcess(child.pid);
      if (!stdout.trim() && !stderr.trim()) {
        reject(new Error('Git 连接超时（15秒），无任何输出。\n\n可能原因:\n  1. 网络无法访问仓库地址（检查代理/VPN）\n  2. SSH 密钥未配置\n  3. HTTPS 认证信息未填写\n\n如果使用 SSH 地址 (git@...):\n  - 运行 ssh -T git@gitee.com（或 git@github.com）测试\n  - 确保 SSH 公钥已添加到 Git 平台\n\n如果使用 HTTPS 地址 (https://...):\n  - 在设置中填写用户名和 Token\n  - Gitee: 设置 → 私人令牌\n  - GitHub: Settings → Developer settings → Personal access tokens → repo 权限'));
      } else {
        reject(new Error(`Git 连接超时（15秒）。\n\n最后输出:\n${(stderr + stdout).trim().substring(0, 500) || '(空)'}`));
      }
    }, 15000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        resolve();
      } else {
        const msg = (stderr + stdout).trim();
        if (!msg) {
          reject(new Error('Git 命令无输出。\n\n请检查:\n1. 系统中是否已安装 Git\n2. Git 是否在 PATH 环境变量中\n3. 仓库地址是否正确'));
        } else if (msg.includes('Permission denied') || msg.includes('Authentication failed')) {
          reject(new Error('Git 认证失败。\n\nSSH 地址 → 请先运行 ssh -T git@gitee.com（或 git@github.com）确认密钥已配置\nHTTPS 地址 → 请在设置中填写用户名和 Token（Gitee: 私人令牌 / GitHub: Personal Access Token）'));
        } else if (msg.includes('Could not resolve host') || msg.includes('unable to access') || msg.includes('Could not resolve')) {
          reject(new Error(`无法解析仓库地址，请检查:\n1. 网络是否连通\n2. URL 是否正确: ${url}`));
        } else if (msg.includes('not found') || msg.includes('Repository not found')) {
          reject(new Error('仓库不存在或无访问权限'));
        } else {
          reject(new Error(`Git 连接失败:\n${msg.substring(0, 500)}`));
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('系统中未找到 Git。\n\n请确认:\n1. 已安装 Git: https://git-scm.com/download/win\n2. Git 已添加到系统 PATH 环境变量\n3. 重启应用后重试'));
      } else {
        reject(new Error(`无法执行 git 命令: ${err.message}`));
      }
    });
  });
}

async function checkout(config) {
  const { url, branch, tag, cloneDir, username, token } = config.git;
  const authUrl = buildAuthUrl(url, username, token);

  // Always start fresh — remove old cache to avoid stale files
  if (fs.existsSync(cloneDir)) {
    console.log('  清理旧缓存...');
    fs.removeSync(cloneDir);
  }

  console.log('  克隆仓库...');
  fs.ensureDirSync(cloneDir);
  await simpleGit().clone(authUrl, cloneDir);

  const git = simpleGit(cloneDir);

  const target = tag || branch;
  const type = tag ? 'tag' : 'branch';

  console.log(`  切换到 ${type}: ${target}`);
  await git.checkout(target);
  await git.pull('origin', tag ? `refs/tags/${tag}` : branch);

  // Rewrite submodule SSH URLs to HTTPS in .gitmodules
  if (url.startsWith('https://')) {
    const domain = new URL(url).hostname;
    const modulesFile = path.join(cloneDir, '.gitmodules');
    if (fs.existsSync(modulesFile)) {
      let content = fs.readFileSync(modulesFile, 'utf8');
      const sshPattern = new RegExp(`git@${domain.replace(/\./g, '\\.')}:`, 'g');
      if (content.match(sshPattern)) {
        const httpsBase = username && token
          ? `https://${encodeURIComponent(username)}:${encodeURIComponent(token)}@${domain}/`
          : `https://${domain}/`;
        content = content.replace(sshPattern, httpsBase);
        fs.writeFileSync(modulesFile, content, 'utf8');
        console.log('  已重写 .gitmodules: SSH → HTTPS');
        await git.raw(['submodule', 'sync', '--recursive']);
      }
    }
  }

  // Init and update submodules recursively
  console.log('  初始化子模块...');
  await git.raw(['submodule', 'update', '--init', '--recursive']);

  const log = await git.log({ maxCount: 1 });
  const commit = log.latest;

  console.log(`  ✓ 代码就绪: ${commit.hash.slice(0, 8)} - ${commit.message.split('\n')[0]}`);

  return {
    hash: commit.hash.slice(0, 8),
    fullHash: commit.hash,
    message: commit.message.split('\n')[0],
    date: commit.date,
    branch: tag ? `tag:${tag}` : branch,
  };
}

function getBuildDir(config) {
  return path.resolve(config.git.cloneDir, config.build.outputDir);
}

function runLsRemote(authUrl, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['ls-remote', authUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=8',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killProcess(child.pid);
      reject(new Error('Git 操作超时'));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        const msg = (stderr || stdout).trim();
        reject(new Error(msg || 'Git ls-remote 失败'));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function fetchBranches(config) {
  const { url, username, token } = config.git;
  const authUrl = buildAuthUrl(url, username, token);
  const output = await runLsRemote(authUrl);
  const branches = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^[0-9a-f]+\trefs\/heads\/(.+)$/);
    if (m) {
      branches.push({ name: m[1], hash: line.split('\t')[0] });
    }
  }
  return branches;
}

async function fetchTags(config) {
  const { url, username, token } = config.git;
  const authUrl = buildAuthUrl(url, username, token);
  const output = await runLsRemote(authUrl);
  const seen = new Set();
  const tags = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^[0-9a-f]+\trefs\/tags\/(.+)$/);
    if (!m) continue;
    let name = m[1];
    // Skip dereferenced annotated tag entries (ending with ^{})
    if (name.endsWith('^{}')) {
      name = name.slice(0, -3);
    }
    if (!seen.has(name)) {
      seen.add(name);
      tags.push({ name, hash: line.split('\t')[0] });
    }
  }
  // Sort descending: semantic version aware (v2.0.0 > v1.10.0 > v1.2.0)
  tags.sort((a, b) => {
    const na = a.name.replace(/^[vV]/, '');
    const nb = b.name.replace(/^[vV]/, '');
    const sa = na.split(/[.\-_]/);
    const sb = nb.split(/[.\-_]/);
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const va = parseInt(sa[i], 10);
      const vb = parseInt(sb[i], 10);
      if (!isNaN(va) && !isNaN(vb)) {
        if (va !== vb) return vb - va;
      } else {
        const ca = (sa[i] || '').localeCompare(sb[i] || '', undefined, { numeric: true });
        if (ca !== 0) return -ca;
      }
    }
    return 0;
  });
  return tags;
}

module.exports = { checkout, getBuildDir, testConnection, fetchBranches, fetchTags };
