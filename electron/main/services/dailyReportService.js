const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const constants = require('../config/constants');
const { spawnPythonModule, execPythonModule } = require('./pythonService');
const { emitInternalLog } = require('./emitterService');

function withTempJsonFilePairs(task) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-agent-report-'));
  try {
    return task(tempDir);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

async function generateDailyReport(payload) {
  emitInternalLog('info', 'report', '开始生成每日报告（后台异步）...');

  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-agent-report-'));
    const inputFile = path.join(tempDir, 'input.json');
    const outputFile = path.join(tempDir, 'output.json');

    try {
      fs.writeFileSync(inputFile, JSON.stringify(payload, null, 2), 'utf8');

      const child = spawnPythonModule(constants.STORE_MODULE, [
        'generate-daily-report-file',
        inputFile,
        outputFile
      ], { preferVenv: false });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup failures
        }

        if (code !== 0) {
          const errorMsg = stderr || stdout || `Python 进程退出码 ${code}`;
          emitInternalLog('warn', 'report', `报告生成失败：${errorMsg}`);
          reject(new Error(errorMsg));
          return;
        }

        try {
          const raw = fs.readFileSync(outputFile, 'utf8');
          const result = JSON.parse(raw);
          emitInternalLog('success', 'report', `报告生成完成：${result.reportId}`);
          resolve(result);
        } catch (error) {
          emitInternalLog('warn', 'report', `报告结果解析失败：${error.message}`);
          reject(error);
        }
      });

      child.on('error', (error) => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup failures
        }
        emitInternalLog('warn', 'report', `报告生成进程启动失败：${error.message}`);
        reject(error);
      });
    } catch (error) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures
      }
      emitInternalLog('warn', 'report', `报告生成准备失败：${error.message}`);
      reject(error);
    }
  });
}

function listDailyReports() {
  return withTempJsonFilePairs((tempDir) => {
    const outputFile = path.join(tempDir, 'output.json');

    execPythonModule(constants.STORE_MODULE, [
      'list-daily-reports-file',
      outputFile
    ], { preferVenv: false });

    const raw = fs.readFileSync(outputFile, 'utf8');
    return JSON.parse(raw);
  });
}

function getDailyReport(reportId) {
  return withTempJsonFilePairs((tempDir) => {
    const inputFile = path.join(tempDir, 'input.json');
    const outputFile = path.join(tempDir, 'output.json');

    fs.writeFileSync(inputFile, JSON.stringify({ reportId }, null, 2), 'utf8');

    execPythonModule(constants.STORE_MODULE, [
      'get-daily-report-file',
      inputFile,
      outputFile
    ], { preferVenv: false });

    const raw = fs.readFileSync(outputFile, 'utf8');
    return JSON.parse(raw);
  });
}

function getPostsByReport(reportId) {
  return withTempJsonFilePairs((tempDir) => {
    const inputFile = path.join(tempDir, 'input.json');
    const outputFile = path.join(tempDir, 'output.json');

    fs.writeFileSync(inputFile, JSON.stringify({ reportId }, null, 2), 'utf8');

    execPythonModule(constants.STORE_MODULE, [
      'get-posts-by-report-file',
      inputFile,
      outputFile
    ], { preferVenv: false });

    const raw = fs.readFileSync(outputFile, 'utf8');
    return JSON.parse(raw);
  });
}

module.exports = {
  generateDailyReport,
  listDailyReports,
  getDailyReport,
  getPostsByReport,
};
