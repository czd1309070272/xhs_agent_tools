export function createModalController({ elements, state, desktopApi }) {
  function openImageZoom(url) {
    if (!url) {
      return;
    }
    elements.zoomedImage.src = url;
    elements.imageZoomModal.hidden = false;
  }

  function closeImageZoom() {
    elements.imageZoomModal.hidden = true;
    elements.zoomedImage.removeAttribute('src');
  }

  function renderModalImage() {
    const images = state.activeResult?.images || [];
    if (images.length === 0) {
      elements.modalActiveImage.hidden = true;
      elements.modalActiveImage.removeAttribute('src');
      elements.modalImageEmpty.hidden = false;
      elements.modalImageIndex.textContent = '没有图片';
      elements.modalPrevImageButton.disabled = true;
      elements.modalNextImageButton.disabled = true;
      elements.modalPrevImageButton.hidden = true;
      elements.modalNextImageButton.hidden = true;
      return;
    }

    const safeIndex = Math.max(0, Math.min(state.activeResultImageIndex, images.length - 1));
    state.activeResultImageIndex = safeIndex;
    elements.modalActiveImage.src = images[safeIndex];
    elements.modalActiveImage.alt = `图片 ${safeIndex + 1}`;
    elements.modalActiveImage.hidden = false;
    elements.modalImageEmpty.hidden = true;
    elements.modalImageIndex.textContent = `第 ${safeIndex + 1} / ${images.length} 张`;
    elements.modalPrevImageButton.disabled = safeIndex === 0;
    elements.modalNextImageButton.disabled = safeIndex === images.length - 1;
    elements.modalPrevImageButton.hidden = images.length <= 1 || safeIndex === 0;
    elements.modalNextImageButton.hidden = images.length <= 1 || safeIndex === images.length - 1;
  }

  function openResultModal(item) {
    state.activeResult = item;
    state.activeResultImageIndex = 0;
    elements.modalAuthor.textContent = item.author || '匿名作者';
    elements.modalTime.textContent = item.publishedTime || '未知时间';
    elements.modalTitle.textContent = item.title || '未命名帖子';
    elements.modalContent.textContent = item.content || '暂无正文内容';
    elements.modalImageCount.textContent = `共 ${(item.images || []).length} 张`;

    elements.modalStats.innerHTML = '';
    [
      `点赞 ${item.likes || 0}`,
      `评论 ${item.comments || 0}`,
      `收藏 ${item.collects || 0}`,
      `作者 ${item.author || '未知'}`
    ].forEach((text) => {
      const stat = document.createElement('span');
      stat.textContent = text;
      elements.modalStats.appendChild(stat);
    });

    elements.modalTags.innerHTML = '';
    (item.tags || []).forEach((tagText) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tagText;
      elements.modalTags.appendChild(tag);
    });

    renderModalImage();
    elements.resultModal.hidden = false;
  }

  function closeResultModal() {
    elements.resultModal.hidden = true;
    state.activeResult = null;
    state.activeResultImageIndex = 0;
    closeImageZoom();
  }

  function bindEvents() {
    elements.closeResultModalButton.addEventListener('click', closeResultModal);
    elements.resultModal.addEventListener('click', (event) => {
      if (event.target === elements.resultModal || event.target.classList.contains('result-modal-backdrop')) {
        closeResultModal();
      }
    });
    elements.modalOpenPostButton.addEventListener('click', () => {
      if (state.activeResult?.url) {
        desktopApi.openExternal(state.activeResult.url);
      }
    });
    elements.modalPrevImageButton.addEventListener('click', () => {
      if (!state.activeResult) {
        return;
      }
      state.activeResultImageIndex -= 1;
      renderModalImage();
    });
    elements.modalNextImageButton.addEventListener('click', () => {
      if (!state.activeResult) {
        return;
      }
      state.activeResultImageIndex += 1;
      renderModalImage();
    });
    elements.modalActiveImage.addEventListener('click', () => {
      const images = state.activeResult?.images || [];
      if (images[state.activeResultImageIndex]) {
        openImageZoom(images[state.activeResultImageIndex]);
      }
    });
    elements.closeImageZoomButton.addEventListener('click', closeImageZoom);
    elements.imageZoomModal.addEventListener('click', (event) => {
      if (event.target === elements.imageZoomModal || event.target.classList.contains('image-zoom-backdrop')) {
        closeImageZoom();
      }
    });
  }

  return {
    openResultModal,
    closeResultModal,
    closeImageZoom,
    bindEvents
  };
}
