const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const constants = require('../config/constants');
const runtime = require('../state/runtime');
const { execPythonModule, getVenvPythonPath } = require('./pythonService');
const { emitInternalLog } = require('./emitterService');

function withTempJsonFilePairs(task) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-agent-store-'));
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

function browserDataDirExists() {
  try {
    return fs.existsSync(constants.XHS_BROWSER_DATA_DIR)
      && fs.statSync(constants.XHS_BROWSER_DATA_DIR).isDirectory();
  } catch {
    return false;
  }
}

function readJsonArrayFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArrayFile(filePath, results) {
  fs.writeFileSync(filePath, JSON.stringify(Array.isArray(results) ? results : [], null, 2), 'utf8');
}

function readResultsFile() {
  return readJsonArrayFile(constants.RESULT_FILE);
}

function writeResultsFile(results) {
  writeJsonArrayFile(constants.RESULT_FILE, results);
}

function readPreviewResultsFile() {
  if (!fs.existsSync(constants.PREVIEW_STATE_FILE)) {
    return readResultsFile();
  }
  return readJsonArrayFile(constants.PREVIEW_STATE_FILE);
}

function writePreviewResultsFile(results) {
  writeJsonArrayFile(constants.PREVIEW_STATE_FILE, results);
}

function removePostsFromList(results, postIds) {
  if (!Array.isArray(results) || !Array.isArray(postIds) || postIds.length === 0) {
    return Array.isArray(results) ? results : [];
  }

  const blockedIds = new Set(
    postIds.map((postId) => String(postId || '').trim()).filter(Boolean)
  );

  return results.filter((item) => {
    const key = String(item?.id || item?.url || '').trim();
    return !key || !blockedIds.has(key);
  });
}

function resolvePythonExecutable() {
  return getVenvPythonPath();
}

function readPostsFromStore() {
  try {
    const raw = withTempJsonFilePairs((tempDir) => {
      const outputFile = path.join(tempDir, 'posts.json');
      execPythonModule(constants.STORE_MODULE, ['dump-posts-file', outputFile], {
        preferVenv: false
      });
      return fs.readFileSync(outputFile, 'utf8');
    });
    const parsed = JSON.parse(raw);
    emitInternalLog('success', 'storage', `SQLite 读取成功，返回 ${Array.isArray(parsed) ? parsed.length : 0} 条帖子。`);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    emitInternalLog(
      'warn',
      'storage',
      'SQLite 读取失败，已回退到结果文件。',
      error.candidateErrors || error.message
    );
    console.warn('[storageService] readPostsFromStore failed, fallback to result file.', error.candidateErrors || error.message);
    return readResultsFile();
  }
}

function deletePostsFromStore(postIds) {
  const normalizedIds = Array.isArray(postIds)
    ? postIds.map((postId) => String(postId || '').trim()).filter(Boolean)
    : [];

  if (normalizedIds.length === 0) {
    return { deletedCount: 0, posts: readPostsFromStore(), previewResults: readPreviewResultsFile() };
  }

  const raw = withTempJsonFilePairs((tempDir) => {
    const inputFile = path.join(tempDir, 'delete-input.json');
    const outputFile = path.join(tempDir, 'delete-output.json');
    fs.writeFileSync(inputFile, JSON.stringify(normalizedIds, null, 2), 'utf8');
    execPythonModule(constants.STORE_MODULE, ['delete-posts-file', inputFile, outputFile], {
      preferVenv: false
    });
    return fs.readFileSync(outputFile, 'utf8');
  });

  const parsed = JSON.parse(raw);
  const deletedCount = Number(parsed?.deletedCount || 0);
  emitInternalLog('info', 'storage', `删除帖子请求已执行，删除 ${deletedCount} 条。`);

  if (deletedCount > 0) {
    writePreviewResultsFile(removePostsFromList(readPreviewResultsFile(), normalizedIds));
    writeResultsFile(removePostsFromList(readResultsFile(), normalizedIds));
    if (runtime.activeRun?.results) {
      runtime.activeRun.results = removePostsFromList(runtime.activeRun.results, normalizedIds);
    }
  }

  return {
    deletedCount,
    posts: readPostsFromStore(),
    previewResults: readPreviewResultsFile()
  };
}

module.exports = {
  browserDataDirExists,
  readResultsFile,
  writeResultsFile,
  readPreviewResultsFile,
  writePreviewResultsFile,
  removePostsFromList,
  resolvePythonExecutable,
  readPostsFromStore,
  deletePostsFromStore
};
