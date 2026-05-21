const chalk = require('chalk');
const ora = require('ora');
const { SSHClient } = require('./ssh');

async function listVersions(config) {
  const { deploy: deployCfg } = config;
  const ssh = new SSHClient(config);

  console.log(chalk.blue('▶ 连接服务器获取备份列表...'));
  await ssh.connect();

  try {
    const listResult = await ssh.exec(`ls -1 "${deployCfg.remotePath}/.backup/" | sort -r`);
    const backups = listResult.split('\n').filter(Boolean)
      .filter((f) => f.endsWith('.tar.gz'));

    if (backups.length === 0) {
      console.log(chalk.yellow('  没有可用的备份'));
      return [];
    }

    // Read current marker
    let current = null;
    try {
      const marker = await ssh.exec(`cat "${deployCfg.remotePath}/.backup/.current" 2>/dev/null || echo ""`);
      current = marker.trim();
    } catch (_) {}

    const versions = backups.map((f) => f.replace('.tar.gz', ''));

    console.log('');
    console.log(chalk.cyan('  可用备份:'));
    console.log('');

    versions.forEach((v) => {
      const isCurrent = current && current === v;
      const prefix = isCurrent ? chalk.green.bold('  * ') : '    ';
      console.log(prefix + chalk.white(v));
    });

    console.log('');
    console.log(chalk.gray('  * 标记为当前版本'));
    return versions;
  } finally {
    ssh.disconnect();
  }
}

async function rollback(config, targetVersion) {
  const { deploy: deployCfg } = config;
  const ssh = new SSHClient(config);

  if (!targetVersion) {
    const versions = await listVersions(config);
    if (versions.length === 0) return;
    if (versions.length === 1) {
      console.log(chalk.yellow('只有一个备份，无需回滚'));
      return;
    }
    console.log(chalk.cyan('使用以下命令指定回滚版本:'));
    console.log(chalk.gray(`  node src/cli.js rollback --version ${versions[1]}`));
    return;
  }

  const spinner = ora();
  spinner.start(chalk.blue('连接服务器...'));
  await ssh.connect();

  try {
    const rp = deployCfg.remotePath;
    const backupFile = `"${rp}/.backup/${targetVersion}.tar.gz"`;

    // 检查备份是否存在
    try {
      await ssh.exec(`test -f ${backupFile}`);
    } catch {
      spinner.fail(chalk.red(`备份不存在: ${targetVersion}`));
      return;
    }

    // 清空当前文件（.backup 由 glob 保护）
    spinner.text = chalk.blue('恢复备份...');
    await ssh.exec(`rm -rf "${rp}/"*`);
    const result = await ssh.exec(`tar -xzf ${backupFile} -C "${rp}" 2>&1 || echo "TAR_FAILED"`);
    if (result.includes('TAR_FAILED')) {
      spinner.fail(chalk.red(`恢复备份失败: ${result}`));
      return;
    }

    // Mark current version
    await ssh.exec(`echo "${targetVersion}" > "${rp}/.backup/.current"`);

    // 执行部署后命令
    if (config.deploy.postDeployCommands.length > 0) {
      spinner.text = chalk.blue('执行部署后命令...');
      for (const cmd of config.deploy.postDeployCommands) {
        await ssh.exec(cmd);
      }
    }

    spinner.succeed(chalk.green('回滚成功!'));

    console.log('');
    console.log(chalk.green(`  已恢复到备份: ${targetVersion}`));
    console.log(chalk.gray(`  路径: ${deployCfg.remotePath}`));

  } finally {
    ssh.disconnect();
  }
}

module.exports = { rollback, listVersions };
