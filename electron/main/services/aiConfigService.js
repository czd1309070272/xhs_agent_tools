const fs = require('node:fs');

const constants = require('../config/constants');
const { emitInternalLog } = require('./emitterService');

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readSavedAiConfigFile() {
  if (!fs.existsSync(constants.AI_SETTINGS_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(constants.AI_SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      apiKey: normalizeText(parsed?.apiKey),
      baseUrl: normalizeText(parsed?.baseUrl),
      model: normalizeText(parsed?.model)
    };
  } catch (error) {
    emitInternalLog('warn', 'ai-config', 'AI 配置文件读取失败，已回退到环境变量。', error.message);
    return {};
  }
}

function getFallbackAiConfigFromEnv() {
  const openaiApiKey = normalizeText(process.env.OPENAI_API_KEY);
  const deepseekApiKey = normalizeText(process.env.DEEPSEEK_API_KEY);
  const openaiBaseUrl = normalizeText(process.env.OPENAI_BASE_URL);
  const openaiModel = normalizeText(process.env.OPENAI_MODEL);
  const deepseekModel = normalizeText(process.env.DEEPSEEK_MODEL);

  const prefersDeepseekFallback = !openaiApiKey && Boolean(deepseekApiKey);
  const apiKey = openaiApiKey || deepseekApiKey;
  const baseUrl = openaiBaseUrl
    || (prefersDeepseekFallback ? DEFAULT_DEEPSEEK_BASE_URL : DEFAULT_OPENAI_BASE_URL);
  const model = openaiModel
    || deepseekModel
    || (prefersDeepseekFallback ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_OPENAI_MODEL);

  return {
    apiKey,
    baseUrl,
    model,
    source: apiKey ? 'env' : 'default'
  };
}

function buildAiConfigSnapshot() {
  const saved = readSavedAiConfigFile();
  const fallback = getFallbackAiConfigFromEnv();
  const hasSavedConfig = Boolean(saved.apiKey || saved.baseUrl || saved.model);
  const apiKey = saved.apiKey || fallback.apiKey;
  const baseUrl = saved.baseUrl || fallback.baseUrl;
  const model = saved.model || fallback.model;

  return {
    apiKey,
    baseUrl,
    model,
    source: hasSavedConfig ? 'saved' : fallback.source,
    isConfigured: Boolean(apiKey && baseUrl && model)
  };
}

function validateAiConfigInput(payload) {
  const apiKey = normalizeText(payload?.apiKey);
  const baseUrl = normalizeText(payload?.baseUrl);
  const model = normalizeText(payload?.model);

  if (!baseUrl) {
    throw new Error('缺少 AI Base URL。');
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('AI Base URL 必须以 http:// 或 https:// 开头。');
  }
  if (!apiKey) {
    throw new Error('缺少 API Key。');
  }
  if (!model) {
    throw new Error('缺少模型名称。');
  }

  return { apiKey, baseUrl, model };
}

function saveAiConfig(payload) {
  const nextConfig = validateAiConfigInput(payload);
  fs.writeFileSync(
    constants.AI_SETTINGS_FILE,
    JSON.stringify(
      {
        ...nextConfig,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
  emitInternalLog('success', 'ai-config', `AI 配置已保存：${nextConfig.model} @ ${nextConfig.baseUrl}`);
  return buildAiConfigSnapshot();
}

module.exports = {
  buildAiConfigSnapshot,
  saveAiConfig
};
