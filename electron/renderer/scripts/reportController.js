import { elements } from './elements.js';

export function createReportController() {
  let reports = [];
  let currentReportDetail = null;

  function renderReportList() {
    const container = elements.reportListContainer;
    container.innerHTML = '';

    if (reports.length === 0) {
      elements.reportEmptyState.hidden = false;
      elements.reportPageMeta.textContent = '共 0 份报告';
      return;
    }

    elements.reportEmptyState.hidden = true;
    elements.reportPageMeta.textContent = `共 ${reports.length} 份报告`;

    const template = document.getElementById('reportCardTemplate');
    if (!template) {
      alert('错误：reportCardTemplate 模板不存在！');
      return;
    }

    reports.forEach((report) => {
      const card = template.content.cloneNode(true);
      const article = card.querySelector('.report-card');

      const title = card.querySelector('.report-card-title');
      const date = card.querySelector('.report-card-date');
      const posts = card.querySelector('.report-card-posts');
      const status = card.querySelector('.report-card-status');
      const summary = card.querySelector('.report-card-summary');
      const viewDetailBtn = card.querySelector('.report-view-detail-btn');
      const viewPostsBtn = card.querySelector('.report-view-posts-btn');

      title.textContent = report.title || '每日报告';
      date.textContent = report.reportDate || '';
      posts.textContent = `${report.totalPosts || 0} 条帖子`;

      if (report.status === 'done') {
        status.textContent = '✓ 已完成';
        status.style.color = '#10b981';
      } else if (report.status === 'pending') {
        status.textContent = '⏳ 生成中';
        status.style.color = '#f59e0b';
      } else {
        status.textContent = '✗ 失败';
        status.style.color = '#ef4444';
      }

      // 显示摘要前3行
      const summaryLines = (report.summary || '').split('\n').filter(line => line.trim());
      const preview = summaryLines.slice(0, 3).join('\n');
      summary.textContent = preview || '暂无摘要';

      viewDetailBtn.addEventListener('click', () => openReportDetail(report.reportId));
      viewPostsBtn.addEventListener('click', () => openReportPosts(report.reportId));

      container.appendChild(card);
    });
  }

  async function openReportDetail(reportId) {
    try {
      const result = await window.desktopApi.getReport(reportId);
      if (!result.ok || !result.report) {
        alert('报告详情获取失败');
        return;
      }

      currentReportDetail = result.report;
      showReportDetailModal(result.report);
    } catch (error) {
      alert(`打开报告详情失败: ${error.message}`);
    }
  }

  function showReportDetailModal(report) {
    // 创建详情弹窗
    const modal = document.createElement('div');
    modal.className = 'result-modal';
    modal.innerHTML = `
      <div class="result-modal-backdrop"></div>
      <div class="result-modal-panel report-detail-panel">
        <button class="result-modal-close" type="button">关闭</button>
        <div class="result-modal-head">
          <p class="section-kicker">${report.reportDate}</p>
          <h3>${report.title}</h3>
        </div>
        <div class="report-detail-content"></div>
      </div>
    `;

    const content = modal.querySelector('.report-detail-content');

    // 使用简单的 Markdown 渲染（支持基本格式）
    const htmlContent = renderMarkdown(report.summary);
    content.innerHTML = htmlContent;

    const closeBtn = modal.querySelector('.result-modal-close');
    const backdrop = modal.querySelector('.result-modal-backdrop');

    const closeModal = () => {
      modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    document.body.appendChild(modal);
  }

  function renderMarkdown(text) {
    // 按段落分割
    const paragraphs = text.split(/\n\n+/);
    const sections = [];
    let currentSection = null;

    paragraphs.forEach(para => {
      para = para.trim();
      if (!para) return;

      // 检测二级标题（章节）
      const h2Match = para.match(/^## (.+)$/);
      if (h2Match) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: h2Match[1],
          content: []
        };
        return;
      }

      // 其他内容加入当前章节
      if (currentSection) {
        currentSection.content.push(para);
      } else {
        // 没有章节标题的内容，创建默认章节
        if (!currentSection) {
          currentSection = { title: '', content: [] };
        }
        currentSection.content.push(para);
      }
    });

    if (currentSection) {
      sections.push(currentSection);
    }

    // 渲染每个章节
    const sectionsHtml = sections.map(section => {
      const contentHtml = section.content.map(block => {
        // 处理列表
        if (block.startsWith('- ') || block.startsWith('* ')) {
          const items = block.split('\n').filter(line => line.trim());
          const listItems = items.map(item => {
            const cleaned = item.replace(/^[-*]\s+/, '');
            return `<li>${processInline(cleaned)}</li>`;
          }).join('');
          return `<ul>${listItems}</ul>`;
        }

        // 处理三级标题
        const h3Match = block.match(/^### (.+)$/);
        if (h3Match) {
          return `<h4>${processInline(h3Match[1])}</h4>`;
        }

        // 处理分隔线
        if (block.match(/^---+$/)) {
          return '<hr>';
        }

        // 普通段落
        const lines = block.split('\n').map(line => processInline(line)).join('<br>');
        return `<p>${lines}</p>`;
      }).join('');

      if (section.title) {
        return `<div class="report-section">
          <h3 class="report-section-title">${processInline(section.title)}</h3>
          <div class="report-section-content">${contentHtml}</div>
        </div>`;
      } else {
        return `<div class="report-section-content">${contentHtml}</div>`;
      }
    }).join('');

    return `<div class="markdown-content">${sectionsHtml}</div>`;
  }

  function processInline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // 保留 emoji 和特殊字符
      .replace(/(\d+(?:\.\d+)?[万wWkK]?)/g, '<span class="highlight-number">$1</span>');
  }

  async function openReportPosts(reportId) {
    try {
      const result = await window.desktopApi.getReportPosts(reportId);
      if (!result.ok || !result.posts) {
        console.warn('报告帖子获取失败');
        return;
      }

      // 触发帖子仓库页面，并传入筛选参数
      window.dispatchEvent(new CustomEvent('open-library-with-filter', {
        detail: {
          reportId,
          posts: result.posts
        }
      }));
    } catch (error) {
      console.error('打开报告帖子失败:', error);
    }
  }

  async function loadReports() {
    try {
      const result = await window.desktopApi.listReports();
      if (result.ok && Array.isArray(result.reports)) {
        reports = result.reports;
        renderReportList();
      } else {
        alert(`报告加载失败: ${result.error || '未知错误'}`);
      }
    } catch (error) {
      alert(`加载报告列表失败: ${error.message}`);
    }
  }

  function openReportPage() {
    elements.homePage.hidden = true;
    elements.mainPage.hidden = true;
    elements.libraryPage.hidden = true;
    elements.reportPage.hidden = false;
    elements.taskHistorySidebar.classList.remove('expanded');
    elements.taskHistoryShell.classList.add('is-hidden');
    loadReports();
  }

  function closeReportPage() {
    elements.reportPage.hidden = true;
    elements.homePage.hidden = false;
    elements.mainPage.hidden = true;
    elements.taskHistoryShell.classList.add('is-hidden');
  }

  function bindEvents() {
    if (elements.openReportButton) {
      elements.openReportButton.addEventListener('click', () => {
        openReportPage();
      });
    }

    if (elements.openReportFromHomeButton) {
      elements.openReportFromHomeButton.addEventListener('click', () => {
        openReportPage();
      });
    }

    if (elements.closeReportButton) {
      elements.closeReportButton.addEventListener('click', closeReportPage);
    }
  }

  return {
    openReportPage,
    closeReportPage,
    loadReports,
    bindEvents,
  };
}
