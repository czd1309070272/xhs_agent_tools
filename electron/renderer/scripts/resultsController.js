import {
  getLibrarySearchContent,
  getResultIdentity,
  mergeLibraryResults,
  parseMetricValue,
  parsePublishedTimeToTimestamp,
  truncate
} from './utils.js';

export function createResultsController({
  elements,
  state,
  desktopApi,
  appendLog,
  modalController,
  taskHistoryController,
  updateRunAvailability
}) {
  function getFilteredLibraryResults() {
    const keyword = state.librarySearchTerm.trim().toLowerCase();
    return state.libraryResults.filter((item) => {
      if (!keyword) {
        return true;
      }
      return getLibrarySearchContent(item).includes(keyword);
    });
  }

  function openLibraryPage() {
    taskHistoryController.setTaskHistoryOpen(false);
    elements.taskHistoryShell.classList.add('is-hidden');
    elements.mainPage.hidden = true;
    elements.libraryPage.hidden = false;
    if (elements.appShell) {
      elements.appShell.scrollTop = 0;
    }
  }

  function closeLibraryPage() {
    elements.taskHistoryShell.classList.remove('is-hidden');
    elements.mainPage.hidden = false;
    elements.libraryPage.hidden = true;
  }

  function getSortedLibraryResults() {
    const filtered = getFilteredLibraryResults();
    if (state.librarySortMode === 'default') {
      return filtered;
    }

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      if (state.librarySortMode === 'time_asc' || state.librarySortMode === 'time_desc') {
        const leftTime = parsePublishedTimeToTimestamp(left?.publishedTime, left?.updatedAt || left?.createdAt || '');
        const rightTime = parsePublishedTimeToTimestamp(right?.publishedTime, right?.updatedAt || right?.createdAt || '');
        return state.librarySortMode === 'time_asc' ? leftTime - rightTime : rightTime - leftTime;
      }
      if (state.librarySortMode === 'likes_desc') {
        return parseMetricValue(right?.likes) - parseMetricValue(left?.likes);
      }
      if (state.librarySortMode === 'collects_desc') {
        return parseMetricValue(right?.collects) - parseMetricValue(left?.collects);
      }
      if (state.librarySortMode === 'comments_desc') {
        return parseMetricValue(right?.comments) - parseMetricValue(left?.comments);
      }
      return 0;
    });
    return sorted;
  }

  function getLibraryPaginationState(sortedResults = getSortedLibraryResults()) {
    const totalItems = Array.isArray(sortedResults) ? sortedResults.length : 0;
    const pageSize = Math.max(1, Number(state.libraryPageSize) || 20);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const currentPage = Math.min(Math.max(1, state.libraryCurrentPage || 1), totalPages);
    const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);
    return {
      totalItems,
      pageSize,
      totalPages,
      currentPage,
      startIndex,
      endIndex,
    };
  }

  function getVisibleLibraryResults() {
    const sortedResults = getSortedLibraryResults();
    const pagination = getLibraryPaginationState(sortedResults);
    state.libraryCurrentPage = pagination.currentPage;
    return sortedResults.slice(pagination.startIndex, pagination.endIndex);
  }

  function updateLibraryToolbar(visibleResults, sortedResults = getSortedLibraryResults()) {
    const visibleCount = Array.isArray(visibleResults) ? visibleResults.length : 0;
    const selectedCount = state.selectedLibraryPostIds.size;
    const pagination = getLibraryPaginationState(sortedResults);
    const rangeText = pagination.totalItems === 0
      ? '当前显示 0 条'
      : `当前显示 ${pagination.startIndex + 1}-${pagination.endIndex} / ${pagination.totalItems} 条`;
    elements.libraryPageMeta.textContent = `当前收录 ${state.libraryResults.length} 条帖子 · ${rangeText}`;
    elements.librarySelectionMeta.textContent = selectedCount > 0
      ? `已选择 ${selectedCount} 条帖子`
      : '未选择帖子';
    elements.librarySelectVisibleButton.disabled = visibleCount === 0 || state.isDeletingLibraryPosts;
    elements.libraryClearSelectionButton.disabled = selectedCount === 0 || state.isDeletingLibraryPosts;
    elements.libraryBatchDeleteButton.disabled = selectedCount === 0 || state.isDeletingLibraryPosts;
    elements.libraryPagination.hidden = pagination.totalItems <= pagination.pageSize;
    elements.libraryPaginationMeta.textContent = `第 ${pagination.currentPage} / ${pagination.totalPages} 页`;
    elements.libraryPrevPageButton.disabled = pagination.currentPage <= 1 || state.isDeletingLibraryPosts;
    elements.libraryPageInput.value = String(pagination.currentPage);
    elements.libraryPageInput.min = '1';
    elements.libraryPageInput.max = String(pagination.totalPages);
    elements.libraryPageInput.disabled = state.isDeletingLibraryPosts || pagination.totalItems === 0;
    elements.libraryJumpPageButton.disabled = state.isDeletingLibraryPosts || pagination.totalItems === 0;
    elements.libraryNextPageButton.disabled = pagination.currentPage >= pagination.totalPages || state.isDeletingLibraryPosts;
  }

  function jumpToLibraryPage(rawPage) {
    const sortedResults = getSortedLibraryResults();
    const pagination = getLibraryPaginationState(sortedResults);
    const nextPage = Math.min(
      Math.max(1, Number.parseInt(String(rawPage || '').trim(), 10) || pagination.currentPage),
      pagination.totalPages
    );
    state.libraryCurrentPage = nextPage;
    renderResults(state.previewResults);
  }

  function syncLibrarySelection() {
    const validIds = new Set(state.libraryResults.map((item) => getResultIdentity(item)));
    [...state.selectedLibraryPostIds].forEach((postId) => {
      if (!validIds.has(postId)) {
        state.selectedLibraryPostIds.delete(postId);
      }
    });
  }

  function updateLibrarySelectionUI() {
    elements.libraryResultsGrid.querySelectorAll('.result-card.is-selectable').forEach((card) => {
      const itemId = card.dataset.postId || '';
      const selected = state.selectedLibraryPostIds.has(itemId);
      card.classList.toggle('is-selected', selected);
      const toggle = card.querySelector('.card-select-toggle');
      const label = card.querySelector('.card-select-label');
      if (toggle) {
        toggle.classList.toggle('is-selected', selected);
        toggle.setAttribute('aria-pressed', selected ? 'true' : 'false');
        toggle.setAttribute('title', selected ? '取消选择' : '选择帖子');
      }
      if (label) {
        label.textContent = selected ? '已选择' : '选择';
      }
    });

    updateLibraryToolbar(getVisibleLibraryResults(), getSortedLibraryResults());
  }

  async function deleteLibraryPosts(postIds, labelText = '') {
    const normalizedIds = Array.isArray(postIds)
      ? postIds.map((postId) => String(postId || '').trim()).filter(Boolean)
      : [];
    if (normalizedIds.length === 0 || state.isDeletingLibraryPosts) {
      return;
    }

    const countText = normalizedIds.length === 1
      ? `删除帖子「${labelText || '未命名帖子'}」`
      : `批量删除 ${normalizedIds.length} 条帖子`;
    if (!window.confirm(`${countText}？此操作会从帖子仓库中移除对应记录。`)) {
      return;
    }

    state.isDeletingLibraryPosts = true;
    renderResults(state.previewResults);
    appendLog({
      level: 'warn',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: normalizedIds.length === 1
        ? `正在删除帖子：${labelText || normalizedIds[0]}`
        : `正在批量删除 ${normalizedIds.length} 条帖子。`
    });

    try {
      const response = await desktopApi.deleteLibraryPosts(normalizedIds);
      if (!response?.ok) {
        throw new Error(response?.error || '删除失败');
      }

      normalizedIds.forEach((postId) => state.selectedLibraryPostIds.delete(postId));
      state.libraryResults = Array.isArray(response.posts) ? response.posts : [];
      state.previewResults = Array.isArray(response.previewResults) ? response.previewResults : state.previewResults;

      if (state.activeResult && normalizedIds.includes(getResultIdentity(state.activeResult))) {
        modalController.closeResultModal();
      }

      renderResults(state.previewResults);
      appendLog({
        level: 'success',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: response.deletedCount > 0
          ? `已删除 ${response.deletedCount} 条帖子。`
          : '没有匹配到可删除的帖子。'
      });
    } catch (error) {
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: `删除帖子失败：${error.message}`
      });
    } finally {
      state.isDeletingLibraryPosts = false;
      renderResults(state.previewResults);
    }
  }

  function renderResultCards(targetGrid, results, options = {}) {
    const { libraryMode = false } = options;
    targetGrid.innerHTML = '';

    results.forEach((item, index) => {
      const fragment = elements.resultCardTemplate.content.cloneNode(true);
      const card = fragment.querySelector('.result-card');
      const itemId = getResultIdentity(item);

      if (libraryMode) {
        card.classList.add('is-static', 'is-selectable');
        card.dataset.postId = itemId;
        if (state.selectedLibraryPostIds.has(itemId)) {
          card.classList.add('is-selected');
        }
      } else {
        card.style.animationDelay = `${index * 90}ms`;
      }

      fragment.querySelector('.card-author').textContent = item.author || '匿名作者';
      fragment.querySelector('.card-time').textContent = item.publishedTime || '未知时间';
      fragment.querySelector('.card-title').textContent = item.title || '未命名帖子';
      const previewImage = fragment.querySelector('.card-image-preview');
      if (item.images && item.images.length > 0) {
        previewImage.src = item.images[0];
        previewImage.hidden = false;
      }
      fragment.querySelector('.card-content').textContent = truncate(item.content);
      fragment.querySelector('.card-images-meta').textContent = `图片 ${(item.images || []).length} 张`;
      fragment.querySelector('.likes').textContent = `点赞 ${item.likes || 0}`;
      fragment.querySelector('.comments').textContent = `评论 ${item.comments || 0}`;
      fragment.querySelector('.collects').textContent = `收藏 ${item.collects || 0}`;

      const tagRow = fragment.querySelector('.tag-row');
      (item.tags || []).slice(0, 4).forEach((tagText) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = tagText;
        tagRow.appendChild(tag);
      });

      fragment.querySelector('.card-link').addEventListener('click', () => {
        if (item.url) {
          desktopApi.openExternal(item.url);
        }
      });
      fragment.querySelector('.card-link').addEventListener('click', (event) => {
        event.stopPropagation();
      });
      card.addEventListener('click', () => {
        modalController.openResultModal(item);
      });

      if (libraryMode) {
        const controls = document.createElement('div');
        controls.className = 'library-card-controls';

        const selectToggle = document.createElement('button');
        selectToggle.type = 'button';
        selectToggle.className = 'card-select-toggle';
        if (state.selectedLibraryPostIds.has(itemId)) {
          selectToggle.classList.add('is-selected');
        }
        selectToggle.setAttribute('aria-pressed', state.selectedLibraryPostIds.has(itemId) ? 'true' : 'false');
        selectToggle.setAttribute('title', state.selectedLibraryPostIds.has(itemId) ? '取消选择' : '选择帖子');
        selectToggle.addEventListener('click', (event) => {
          event.stopPropagation();
          if (state.selectedLibraryPostIds.has(itemId)) {
            state.selectedLibraryPostIds.delete(itemId);
          } else {
            state.selectedLibraryPostIds.add(itemId);
          }
          updateLibrarySelectionUI();
        });

        const indicator = document.createElement('span');
        indicator.className = 'card-select-indicator';
        indicator.textContent = '✓';

        const label = document.createElement('span');
        label.className = 'card-select-label';
        label.textContent = state.selectedLibraryPostIds.has(itemId) ? '已选择' : '选择';

        selectToggle.append(indicator, label);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'danger-btn card-delete-btn';
        deleteButton.textContent = '删除';
        deleteButton.disabled = state.isDeletingLibraryPosts;
        deleteButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          await deleteLibraryPosts([itemId], item.title || '未命名帖子');
        });

        controls.append(selectToggle, deleteButton);
        card.appendChild(controls);
      }

      targetGrid.appendChild(fragment);
    });
  }

  function renderResults(results) {
    state.previewResults = Array.isArray(results) ? results : [];
    if (state.previewResults.length === 0 && !elements.resultModal.hidden) {
      modalController.closeResultModal();
    }

    syncLibrarySelection();
    const sortedLibraryResults = getSortedLibraryResults();
    const pagination = getLibraryPaginationState(sortedLibraryResults);
    state.libraryCurrentPage = pagination.currentPage;
    const visibleLibraryResults = sortedLibraryResults.slice(pagination.startIndex, pagination.endIndex);
    elements.resultMeta.textContent = `当前展示 ${state.previewResults.length} 条结果`;
    elements.libraryEmptyState.hidden = sortedLibraryResults.length > 0;
    elements.libraryEmptyState.textContent = state.libraryResults.length === 0
      ? '这里会汇总所有已经搜到的帖子，便于统一查看和管理。'
      : '没有匹配当前搜索条件的帖子，请调整关键词或排序方式。';

    renderResultCards(elements.resultsGrid, state.previewResults);
    renderResultCards(elements.libraryResultsGrid, visibleLibraryResults, { libraryMode: true });
    updateLibraryToolbar(visibleLibraryResults, sortedLibraryResults);
    updateRunAvailability();
  }

  function clearPreviewResults() {
    state.previewResults = [];
    if (!elements.resultModal.hidden) {
      modalController.closeResultModal();
    }
    renderResults(state.previewResults);
  }

  function bindEvents() {
    elements.openLibraryButton.addEventListener('click', openLibraryPage);
    elements.closeLibraryButton.addEventListener('click', closeLibraryPage);
    elements.librarySearchInput.addEventListener('input', (event) => {
      state.librarySearchTerm = event.target.value || '';
      state.libraryCurrentPage = 1;
      renderResults(state.previewResults);
    });
    elements.librarySortSelect.addEventListener('change', (event) => {
      state.librarySortMode = event.target.value || 'default';
      state.libraryCurrentPage = 1;
      renderResults(state.previewResults);
    });
    elements.librarySelectVisibleButton.addEventListener('click', () => {
      getVisibleLibraryResults().forEach((item) => {
        state.selectedLibraryPostIds.add(getResultIdentity(item));
      });
      updateLibrarySelectionUI();
    });
    elements.libraryClearSelectionButton.addEventListener('click', () => {
      state.selectedLibraryPostIds.clear();
      updateLibrarySelectionUI();
    });
    elements.libraryBatchDeleteButton.addEventListener('click', async () => {
      await deleteLibraryPosts([...state.selectedLibraryPostIds]);
    });
    elements.libraryPrevPageButton.addEventListener('click', () => {
      state.libraryCurrentPage = Math.max(1, state.libraryCurrentPage - 1);
      renderResults(state.previewResults);
    });
    elements.libraryJumpPageButton.addEventListener('click', () => {
      jumpToLibraryPage(elements.libraryPageInput.value);
    });
    elements.libraryPageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        jumpToLibraryPage(elements.libraryPageInput.value);
      }
    });
    elements.libraryNextPageButton.addEventListener('click', () => {
      state.libraryCurrentPage += 1;
      renderResults(state.previewResults);
    });
    elements.clearResultsButton.addEventListener('click', async () => {
      if (state.previewResults.length === 0) {
        return;
      }
      appendLog({
        level: 'warn',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '正在清理当前预览结果，帖子仓库保留不变。'
      });
      await desktopApi.clearPreviewResults();
      clearPreviewResults();
      appendLog({
        level: 'success',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        message: '当前预览结果已清理，帖子仓库未受影响。'
      });
    });
  }

  function hydrateInitialState(initialState) {
    state.libraryResults = Array.isArray(initialState.sampleResults) ? initialState.sampleResults : [];
    state.previewResults = Array.isArray(initialState.previewResults) ? initialState.previewResults : [];
    state.libraryCurrentPage = 1;
    elements.librarySortSelect.value = state.librarySortMode;
    elements.librarySearchInput.value = state.librarySearchTerm;
    renderResults(state.previewResults);
  }

  function handleCompleted(payload) {
    if (!payload.cancelled) {
      state.libraryResults = mergeLibraryResults(state.libraryResults, payload.results || []);
      renderResults(payload.results || []);
    }
  }

  return {
    openLibraryPage,
    closeLibraryPage,
    renderResults,
    hydrateInitialState,
    handleCompleted,
    bindEvents
  };
}
