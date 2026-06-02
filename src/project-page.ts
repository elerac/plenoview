import './project-page.css';

const embedViewers = document.querySelectorAll('prismifold-viewer[data-responsive-height]');
const mobileEmbedHeightQuery = window.matchMedia('(max-width: 620px)');

function syncEmbedViewerHeight(): void {
  for (const embedViewer of embedViewers) {
    embedViewer.setAttribute('height', mobileEmbedHeightQuery.matches ? '320' : '420');
  }
}

syncEmbedViewerHeight();
mobileEmbedHeightQuery.addEventListener('change', syncEmbedViewerHeight);
