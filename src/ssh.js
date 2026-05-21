const { Client } = require('ssh2');
const fs = require('fs-extra');
const path = require('path');

class SSHClient {
  constructor(config) {
    this.config = config.server;
    this.client = new Client();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.client.on('ready', () => {
        console.log('  ✓ SSH 连接成功');
        resolve();
      });
      this.client.on('error', (err) => {
        reject(new Error(`SSH 连接失败: ${err.message}`));
      });

      const opts = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: 15000,
        keepaliveInterval: 10000,
      };

      if (this.config.privateKey) {
        opts.privateKey = fs.readFileSync(this.config.privateKey);
        if (this.config.passphrase) opts.passphrase = this.config.passphrase;
      } else if (this.config.password) {
        opts.password = this.config.password;
      }

      this.client.connect(opts);
    });
  }

  exec(command) {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          if (code !== 0) reject(new Error(`命令执行失败 (exit ${code}): ${command}\n${stderr}`));
          else resolve(stdout.trim());
        });
      });
    });
  }

  uploadFile(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  disconnect() {
    this.client.end();
  }
}

module.exports = { SSHClient };
