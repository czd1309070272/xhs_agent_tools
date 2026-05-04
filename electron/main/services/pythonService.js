const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const constants = require('../config/constants');

function getVenvPythonPath() {
  return path.join(constants.WORKSPACE_ROOT, '.venv', 'Scripts', 'python.exe');
}

function getPythonCandidates({ preferVenv = true } = {}) {
  const venvPython = getVenvPythonPath();
  const candidates = [];

  if (preferVenv && fs.existsSync(venvPython)) {
    candidates.push({ command: venvPython, prefixArgs: [], label: 'venv-python' });
  }

  candidates.push({ command: 'python', prefixArgs: [], label: 'python' });
  candidates.push({ command: 'py', prefixArgs: ['-3'], label: 'py-3' });

  if (!preferVenv && fs.existsSync(venvPython)) {
    candidates.push({ command: venvPython, prefixArgs: [], label: 'venv-python' });
  }

  return candidates;
}

function execPythonEntry(entryArgs, label, options = {}) {
  const {
    cwd = constants.WORKSPACE_ROOT,
    preferVenv = true,
    encoding = 'utf8',
    maxBuffer = 20 * 1024 * 1024,
    env = {}
  } = options;

  const errors = [];

  for (const candidate of getPythonCandidates({ preferVenv })) {
    try {
      return execFileSync(candidate.command, [...candidate.prefixArgs, ...entryArgs], {
        cwd,
        env: {
          ...process.env,
          ...env,
          PYTHONIOENCODING: 'utf-8'
        },
        encoding,
        windowsHide: true,
        maxBuffer
      });
    } catch (error) {
      errors.push({
        label: candidate.label,
        command: candidate.command,
        message: error.message
      });
    }
  }

  const failure = new Error(`All python candidates failed for ${label}`);
  failure.candidateErrors = errors;
  throw failure;
}

function spawnPythonEntry(entryArgs, label, options = {}) {
  const {
    cwd = constants.WORKSPACE_ROOT,
    preferVenv = true,
    stdio = ['pipe', 'pipe', 'pipe'],
    env = {}
  } = options;

  const candidates = getPythonCandidates({ preferVenv });
  let index = 0;

  function spawnNext() {
    if (index >= candidates.length) {
      const error = new Error(`All python candidates failed for ${label}`);
      error.candidateErrors = candidates.map((candidate) => ({
        label: candidate.label,
        command: candidate.command
      }));
      throw error;
    }

    const candidate = candidates[index++];
    try {
      const child = spawn(candidate.command, [...candidate.prefixArgs, ...entryArgs], {
        cwd,
        env: {
          ...process.env,
          ...env,
          PYTHONIOENCODING: 'utf-8'
        },
        stdio,
        windowsHide: true
      });
      child.__pythonCandidate = candidate;
      return child;
    } catch {
      return spawnNext();
    }
  }

  return spawnNext();
}

function execPythonScript(scriptPath, scriptArgs = [], options = {}) {
  return execPythonEntry([scriptPath, ...scriptArgs], scriptPath, options);
}

function spawnPythonScript(scriptPath, scriptArgs = [], options = {}) {
  return spawnPythonEntry([scriptPath, ...scriptArgs], scriptPath, options);
}

function execPythonModule(moduleName, moduleArgs = [], options = {}) {
  return execPythonEntry(['-m', moduleName, ...moduleArgs], moduleName, options);
}

function spawnPythonModule(moduleName, moduleArgs = [], options = {}) {
  return spawnPythonEntry(['-m', moduleName, ...moduleArgs], moduleName, options);
}

module.exports = {
  execPythonEntry,
  spawnPythonEntry,
  execPythonScript,
  spawnPythonScript,
  execPythonModule,
  spawnPythonModule,
  getPythonCandidates,
  getVenvPythonPath
};
