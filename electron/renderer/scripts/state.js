export const state = {
  isRunning: false,
  runStatusText: '待机中',
  runStatusHint: '等待任务启动。',
  isAiThinking: false,
  liveStatusText: '等待任务启动。',
  liveStatusHint: '搜索状态会在这里轮转更新，详细过程可展开查看。',
  liveStatusTimestamp: '',
  isDeletingAccount: false,
  isDeletingLibraryPosts: false,
  previewLastUpdatedAt: 0,
  previewCountdownTimer: null,
  activeResult: null,
  activeResultImageIndex: 0,
  previewResults: [],
  libraryResults: [],
  taskHistoryEntries: [],
  internalLogs: [],
  isTaskHistoryOpen: false,
  isAiSettingsOpen: false,
  isSavingAiConfig: false,
  librarySearchTerm: '',
  librarySortMode: 'default',
  libraryCurrentPage: 1,
  libraryPageSize: 20,
  selectedLibraryPostIds: new Set(),
  aiConfig: {
    apiKey: '',
    baseUrl: '',
    model: '',
    source: 'default',
    isConfigured: false
  },
  loginState: {
    status: 'checking',
    isLoggedIn: false,
    isRunning: false
  }
};
