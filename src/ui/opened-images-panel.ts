import type { OpenedImageOptionItem } from './image-browser-types';
import { DisposableBag, type Disposable } from '../lifecycle';
import {
  displayCacheBudgetMbToBytes,
  normalizeDisplayCacheBudgetPreference,
  type DisplayCacheBudgetPreference
} from '../display-cache';
import type { MemoryUsageSnapshot } from '../memory/memory-accounting';
import type { OpenedImageDropPlacement } from '../types';
import type { OpenedImagesPanelElements } from './elements';
import {
  applyListboxRowSizing,
  findClosestListRow,
  focusSelectedImageBrowserRow,
  getImageBrowserRows,
  handleImageBrowserListKeyDown,
  isFocusWithinElement,
  isNestedInteractiveListControl,
  renderEmptyListMessage,
  renderKeyedChildren,
  syncSelectOptions
} from './render-helpers';

const OPENED_IMAGES_MAX_VISIBLE_ROWS = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';
const OPENED_FILE_INFO_TOOLTIP_ID = 'opened-file-info-tooltip';
const OPENED_FILE_INFO_TOOLTIP_DELAY_MS = 75;
const OPENED_FILE_INFO_TOOLTIP_GAP_PX = 8;
const OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX = 8;
const OPENED_FILE_INFO_TOOLTIP_ANCHOR_SELECTOR =
  '.opened-file-thumbnail, .opened-file-thumbnail-loading, .file-row-icon';

interface OpenedImagesPanelCallbacks {
  onOpenedImageSelected: (sessionId: string) => void;
  onOpenedImageDroppedToViewer: (sessionId: string, clientX: number, clientY: number) => void;
  onOpenedImageRowClick: () => void;
  onOpenedImageDisplayNameChange: (sessionId: string, displayName: string) => void;
  onReorderOpenedImage: (
    draggedSessionId: string,
    targetSessionId: string,
    placement: OpenedImageDropPlacement
  ) => void;
  onDisplayCacheBudgetPreferenceChange: (preference: DisplayCacheBudgetPreference) => void;
  onReloadSelectedOpenedImage: (sessionId: string) => void;
  onRetryPendingOpenedImageLoad: (sessionId: string) => void;
  onCloseSelectedOpenedImage: (sessionId: string) => void;
}

interface OpenedImageDropTarget {
  sessionId: string;
  placement: OpenedImageDropPlacement;
}

interface OpenedImageDragState {
  sessionId: string;
  lastTargetKey: string | null;
  dropTarget: OpenedImageDropTarget | null;
  isDragging: boolean;
  dragImage: HTMLElement | null;
}

interface OpenedFileRenameState {
  sessionId: string;
  initialLabel: string;
}

interface OpenedFileRowRefs {
  thumbnail: HTMLElement;
  label: HTMLSpanElement;
  renameInput: HTMLInputElement | null;
  reloadButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
}

interface OpenedFileRowCallbacks {
  onPointerEnter: (row: HTMLDivElement) => void;
  onPointerLeave: (row: HTMLDivElement) => void;
  onFocusIn: (row: HTMLDivElement) => void;
  onFocusOut: (row: HTMLDivElement, relatedTarget: EventTarget | null) => void;
}

const openedFileRowRefs = new WeakMap<HTMLElement, OpenedFileRowRefs>();
const OPENED_FILE_DRAG_MIME = 'application/x-prismifold-opened-file';
const OPENED_FILE_DRAG_IMAGE_OFFSET_X = 16;
const OPENED_FILE_DRAG_IMAGE_OFFSET_Y = 16;

export class OpenedImagesPanel implements Disposable {
  private readonly disposables = new DisposableBag();
  private isLoading = false;
  private isViewerBlocked = false;
  private openedImageCount = 0;
  private openedImagesActiveId: string | null = null;
  private openedImageItems: OpenedImageOptionItem[] = [];
  private suppressOpenedImageSelectionUntilMs = 0;
  private openedImageDragState: OpenedImageDragState | null = null;
  private openedFileRenameState: OpenedFileRenameState | null = null;
  private openedFilesFilterText = '';
  private restoreOpenedFilesFocusAfterLoading = false;
  private displayCacheBudgetPreference: DisplayCacheBudgetPreference = { mode: 'automatic', fixedMb: 256 };
  private displayCacheResolvedBudgetMb = 256;
  private openedFileInfoTooltipRow: HTMLDivElement | null = null;
  private openedFileInfoTooltipElement: HTMLDivElement | null = null;
  private openedFileInfoTooltipTimer: number | null = null;
  private suppressOpenedFileFocusTooltipRow: HTMLElement | null = null;
  private suppressOpenedFileFocusTooltipUntilMs = 0;
  private disposed = false;

  constructor(
    private readonly elements: OpenedImagesPanelElements,
    private readonly callbacks: OpenedImagesPanelCallbacks
  ) {
    this.elements.openedImagesSelect.disabled = true;
    this.elements.openedFilesFilterInput.disabled = true;
    this.elements.displayCacheBudgetModeInput.disabled = false;
    this.elements.displayCacheBudgetInput.disabled = true;
    this.elements.reloadAllOpenedImagesButton.disabled = true;
    this.elements.closeAllOpenedImagesButton.disabled = true;

    const onOpenedImagesSelect = (event: Event): void => {
      if (this.openedImageDragState || performance.now() < this.suppressOpenedImageSelectionUntilMs) {
        return;
      }

      const target = event.currentTarget as HTMLSelectElement;
      this.chooseOpenedImage(target.value);
    };
    this.disposables.addEventListener(this.elements.openedImagesSelect, 'change', onOpenedImagesSelect);
    this.disposables.addEventListener(this.elements.openedImagesSelect, 'input', onOpenedImagesSelect);
    this.disposables.addEventListener(this.elements.openedFilesFilterInput, 'input', (event) => {
      this.commitActiveOpenedFileRename();
      this.finishOpenedImagesDrag();
      this.openedFilesFilterText = (event.currentTarget as HTMLInputElement).value;
      this.renderOpenedFileRows();
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'click', (event) => {
      this.hideOpenedFileInfoTooltip();
      if (this.openedImageDragState || performance.now() < this.suppressOpenedImageSelectionUntilMs) {
        event.preventDefault();
        return;
      }

      if (isOpenedFileRenameInput(event.target)) {
        return;
      }

      this.commitActiveOpenedFileRename();

      if (this.elements.openedImagesSelect.disabled) {
        return;
      }

      const row = findClosestListRow(event.target, 'sessionId');
      if (
        !row ||
        row.getAttribute('aria-disabled') === 'true' ||
        isNestedInteractiveListControl(event.target, row)
      ) {
        return;
      }

      const isFilenameClick = isOpenedFileLabelTarget(event.target, row);
      event.preventDefault();
      if (isFilenameClick) {
        this.suppressNextOpenedFileFocusTooltip(row);
        this.hideOpenedFileInfoTooltip();
      }
      row.focus();
      this.callbacks.onOpenedImageRowClick();
      this.chooseOpenedImage(row.dataset.sessionId ?? '');
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'dragstart', (event) => {
      this.handleOpenedFileDragStart(event);
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'dragover', (event) => {
      this.handleOpenedFilesListDragOver(event);
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'dragleave', (event) => {
      this.handleOpenedFilesListDragLeave(event);
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'drop', (event) => {
      this.handleOpenedFilesListDrop(event);
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'dragend', () => {
      this.finishOpenedImagesDrag();
    });
    this.disposables.addEventListener(this.elements.viewerContainer, 'dragenter', (event) => {
      this.handleViewerOpenedFileDragEnter(event);
    });
    this.disposables.addEventListener(this.elements.viewerContainer, 'dragover', (event) => {
      this.handleViewerOpenedFileDragOver(event);
    });
    this.disposables.addEventListener(this.elements.viewerContainer, 'dragleave', (event) => {
      this.handleViewerOpenedFileDragLeave(event);
    });
    this.disposables.addEventListener(this.elements.viewerContainer, 'drop', (event) => {
      this.handleViewerOpenedFileDrop(event);
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'dblclick', (event) => {
      if (isOpenedFileRenameInput(event.target)) {
        return;
      }

      const label =
        event.target instanceof Element ? event.target.closest<HTMLElement>('.opened-file-label') : null;
      if (!label) {
        return;
      }

      const row = findClosestListRow(label, 'sessionId');
      if (
        !row ||
        !row.contains(label) ||
        row.getAttribute('aria-disabled') === 'true' ||
        isNestedInteractiveListControl(event.target, row)
      ) {
        return;
      }

      event.preventDefault();
      if (!this.elements.openedImagesSelect.disabled) {
        const sessionId = row.dataset.sessionId ?? '';
        this.elements.openedImagesSelect.value = sessionId;
        if (sessionId !== this.openedImagesActiveId) {
          this.chooseOpenedImage(sessionId);
        }
        this.startOpenedFileRename(sessionId);
      }
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'keydown', (event) => {
      if (this.handleOpenedFileRenameInputKeyDown(event)) {
        return;
      }

      const reorderDelta = getOpenedFilesKeyboardReorderDelta(event);
      if (reorderDelta !== null) {
        if (this.reorderActiveItem(reorderDelta)) {
          event.preventDefault();
        }
        return;
      }
      if (isOpenedFilesKeyboardReorderCandidate(event)) {
        return;
      }

      if (event.key === 'Enter') {
        const row = findClosestListRow(event.target, 'sessionId');
        if (row && !isNestedInteractiveListControl(event.target, row)) {
          event.preventDefault();
          if (!this.elements.openedImagesSelect.disabled) {
            const sessionId = row.dataset.sessionId ?? '';
            this.elements.openedImagesSelect.value = sessionId;
            if (sessionId !== this.openedImagesActiveId) {
              this.chooseOpenedImage(sessionId);
            }
            this.startOpenedFileRename(sessionId);
          }
          return;
        }
      }

      handleImageBrowserListKeyDown(event, this.elements.openedFilesList, (row) => {
        if (this.elements.openedImagesSelect.disabled) {
          return;
        }
        this.chooseOpenedImage(row.dataset.sessionId ?? '');
      });
    });
    this.disposables.addEventListener(this.elements.openedFilesList, 'focusout', (event) => {
      if (isOpenedFileRenameInput(event.target)) {
        this.commitOpenedFileRename(event.target);
      }
    });

    this.disposables.addEventListener(this.elements.displayCacheBudgetModeInput, 'change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const mode = target.value === 'fixed' ? 'fixed' : 'automatic';
      this.callbacks.onDisplayCacheBudgetPreferenceChange({
        ...this.displayCacheBudgetPreference,
        mode
      });
    });
    this.disposables.addEventListener(this.elements.displayCacheBudgetInput, 'change', (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const value = Number(target.value);
      if (!Number.isFinite(value)) {
        this.setDisplayCacheBudget(this.displayCacheBudgetPreference, this.displayCacheResolvedBudgetMb);
        return;
      }

      this.callbacks.onDisplayCacheBudgetPreferenceChange({
        mode: 'fixed',
        fixedMb: value
      });
    });

    this.disposables.addEventListener(window, 'blur', () => {
      this.commitActiveOpenedFileRename();
      this.finishOpenedImagesDrag();
      this.hideOpenedFileInfoTooltip();
    });
    this.disposables.addEventListener(window, 'resize', () => {
      this.repositionOpenedFileInfoTooltip();
    });
    this.disposables.addEventListener(window, 'scroll', () => {
      this.repositionOpenedFileInfoTooltip();
    }, true);
    this.disposables.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape') {
        this.hideOpenedFileInfoTooltip();
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hideOpenedFileInfoTooltip();
    this.cancelOpenedFileRename();
    this.finishOpenedImagesDrag();
    this.elements.openedFilesList.replaceChildren();
    this.elements.openedImagesSelect.replaceChildren();
    this.elements.openedFilesFilterInput.value = '';
    this.elements.openedFilesFilterInput.disabled = true;
    this.disposables.dispose();
  }

  getOpenedImageCount(): number {
    return this.openedImageCount;
  }

  stepSelection(delta: -1 | 1): boolean {
    if (
      this.disposed ||
      !this.elements.openedFilesList.isConnected ||
      this.isLoading ||
      this.elements.openedImagesSelect.disabled ||
      this.elements.openedFilesList.hidden ||
      this.openedImageItems.length === 0
    ) {
      return false;
    }

    const selectableItems = getSelectableOpenedImageItems(this.getVisibleOpenedImageItems());
    if (selectableItems.length === 0) {
      return false;
    }

    const currentId = this.openedImagesActiveId ?? this.elements.openedImagesSelect.value;
    const currentIndex = selectableItems.findIndex((item) => item.id === currentId);
    let nextIndex: number;
    if (currentIndex >= 0) {
      nextIndex = Math.max(0, Math.min(selectableItems.length - 1, currentIndex + delta));
    } else {
      nextIndex = delta > 0 ? 0 : selectableItems.length - 1;
    }
    const nextSessionId = selectableItems[nextIndex]?.id ?? null;
    if (!nextSessionId) {
      return false;
    }

    if (nextSessionId !== this.openedImagesActiveId) {
      this.chooseOpenedImage(nextSessionId);
    }

    return true;
  }

  reorderActiveItem(delta: -1 | 1): boolean {
    if (
      this.disposed ||
      !this.elements.openedFilesList.isConnected ||
      this.elements.openedImagesSelect.disabled ||
      this.elements.openedFilesList.hidden ||
      this.openedImageItems.length === 0
    ) {
      return false;
    }

    const selectableItems = getSelectableOpenedImageItems(this.getVisibleOpenedImageItems());
    const currentId = this.openedImagesActiveId ?? this.elements.openedImagesSelect.value;
    const currentIndex = selectableItems.findIndex((item) => item.id === currentId);
    if (currentIndex < 0) {
      return false;
    }

    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= selectableItems.length) {
      return true;
    }

    const targetSessionId = selectableItems[targetIndex]?.id ?? null;
    if (!targetSessionId) {
      return false;
    }

    this.finishOpenedImagesDrag();
    this.openedImagesActiveId = currentId;
    this.elements.openedImagesSelect.value = currentId;
    this.callbacks.onReorderOpenedImage(currentId, targetSessionId, delta < 0 ? 'before' : 'after');
    return true;
  }

  setLoading(loading: boolean, viewerBlocked = loading): void {
    if (this.disposed) {
      return;
    }

    if (loading) {
      this.hideOpenedFileInfoTooltip();
      this.finishOpenedImagesDrag();
      this.cancelOpenedFileRename();
      this.restoreOpenedFilesFocusAfterLoading = isFocusWithinElement(this.elements.openedFilesList);
    }

    this.isLoading = loading;
    this.isViewerBlocked = viewerBlocked;
    this.updateControlState();
    this.renderOpenedFileRows();

    if (!viewerBlocked) {
      if (this.restoreOpenedFilesFocusAfterLoading) {
        focusSelectedImageBrowserRow(this.elements.openedFilesList);
      }
      this.restoreOpenedFilesFocusAfterLoading = false;
    }
  }

  setDisplayCacheBudget(preference: DisplayCacheBudgetPreference, resolvedBudgetMb: number): void {
    if (this.disposed) {
      return;
    }

    this.displayCacheBudgetPreference = normalizeDisplayCacheBudgetPreference(preference);
    this.displayCacheResolvedBudgetMb = Math.max(0, Math.round(resolvedBudgetMb));
    this.elements.displayCacheBudgetModeInput.value = this.displayCacheBudgetPreference.mode;
    this.elements.displayCacheBudgetInput.value = String(this.displayCacheBudgetPreference.fixedMb);
    this.syncDisplayCacheBudgetControls();
    this.elements.displayCacheBudgetBreakdownValue.textContent = formatDisplayCacheBudgetLabel(
      this.displayCacheBudgetPreference,
      displayCacheBudgetMbToBytes(this.displayCacheResolvedBudgetMb)
    );
  }

  setDisplayCacheUsage(snapshot: MemoryUsageSnapshot, budgetBytes: number): void {
    if (this.disposed) {
      return;
    }

    const state = getDisplayCacheMemoryUsageState(snapshot, budgetBytes);
    this.elements.displayCacheBudgetBreakdownValue.textContent = formatDisplayCacheBudgetLabel(
      this.displayCacheBudgetPreference,
      budgetBytes
    );
    this.elements.displayCacheDecodedPixelsValue.textContent = formatFileSizeMb(snapshot.decodedBytes);
    this.elements.displayCacheGpuTexturesValue.textContent = formatFileSizeMb(snapshot.gpuTextureBytes);
    this.elements.displayCacheCpuMaterializedValue.textContent = formatFileSizeMb(snapshot.cpuMaterializedBytes);
    this.elements.displayCacheAnalysisCacheValue.textContent = formatFileSizeMb(snapshot.analysisCacheBytes);
    this.elements.displayCacheInFlightReservationsValue.textContent = formatFileSizeMb(snapshot.activeReservationBytes);
    this.elements.displayCacheInFlightReservationsRow.classList.toggle(
      'hidden',
      snapshot.activeReservationBytes <= 0
    );
    this.elements.displayCacheUsage.textContent = formatFileSizeMb(snapshot.totalTrackedBytes);
    this.elements.displayCacheUsage.setAttribute(
      'title',
      `Total tracked memory: ${formatFileSizeMb(snapshot.totalTrackedBytes)}; Display cache budget: ${formatFileSizeMb(budgetBytes)}`
    );
    this.elements.displayCacheControl.classList.toggle('is-over-budget', state.overBudget);
    this.elements.displayCacheUsage.classList.toggle('is-over-budget', state.overBudget);
  }

  setOpenedImageOptions(items: OpenedImageOptionItem[], activeId: string | null): void {
    if (this.disposed) {
      return;
    }

    this.openedImageCount = items.length;
    this.openedImageItems = items.map((item) => ({ ...item }));
    if (
      this.openedFileRenameState &&
      !items.some((item) => item.id === this.openedFileRenameState?.sessionId)
    ) {
      this.openedFileRenameState = null;
    }
    applyListboxRowSizing(this.elements.openedImagesSelect, items.length, OPENED_IMAGES_MAX_VISIBLE_ROWS);
    syncSelectOptions(
      this.elements.openedImagesSelect,
      items.map((item) => ({
        value: item.id,
        label: item.label,
        disabled: item.selectable === false
      }))
    );
    this.openedImagesActiveId = null;

    const firstSelectableItem = items.find((item) => item.selectable !== false) ?? null;
    if (activeId && items.some((item) => item.id === activeId && item.selectable !== false)) {
      this.elements.openedImagesSelect.value = activeId;
      this.openedImagesActiveId = activeId;
    } else if (firstSelectableItem) {
      this.elements.openedImagesSelect.value = firstSelectableItem.id;
      this.openedImagesActiveId = firstSelectableItem.id;
    } else {
      this.elements.openedImagesSelect.selectedIndex = -1;
    }

    this.updateControlState();
    this.renderOpenedFileRows();
  }

  private updateControlState(): void {
    const selectionDisabled = this.isViewerBlocked || this.openedImageCount === 0;
    this.elements.openedImagesSelect.disabled = selectionDisabled;
    this.elements.openedFilesFilterInput.disabled = selectionDisabled;
    this.elements.displayCacheBudgetModeInput.disabled = this.isLoading;
    this.syncDisplayCacheBudgetControls();
    this.elements.reloadAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
    this.elements.closeAllOpenedImagesButton.disabled = this.isLoading || this.openedImageCount === 0;
  }

  private syncDisplayCacheBudgetControls(): void {
    const fixed = this.displayCacheBudgetPreference.mode === 'fixed';
    this.elements.displayCacheBudgetFixedRow.classList.toggle('hidden', !fixed);
    this.elements.displayCacheBudgetInput.disabled = this.isLoading || !fixed;
  }

  private renderOpenedFileRows(): void {
    this.hideOpenedFileInfoTooltip();
    const selectionDisabled = this.isViewerBlocked || this.openedImageCount === 0;
    const actionDisabled = this.isLoading || selectionDisabled;
    const shouldRestoreFocus = !selectionDisabled && isFocusWithinElement(this.elements.openedFilesList);
    this.elements.openedFilesCount.textContent = String(this.openedImageItems.length);
    this.elements.openedFilesList.classList.toggle('is-disabled', selectionDisabled);

    if (this.openedImageItems.length === 0) {
      this.openedFileRenameState = null;
      this.setOpenedFilesFilterText('');
      renderEmptyListMessage(this.elements.openedFilesList, 'No open files');
      return;
    }

    const visibleItems = this.getVisibleOpenedImageItems();
    if (
      this.openedFileRenameState &&
      !visibleItems.some((item) => item.id === this.openedFileRenameState?.sessionId)
    ) {
      this.openedFileRenameState = null;
    }

    if (visibleItems.length === 0) {
      renderEmptyListMessage(this.elements.openedFilesList, 'No matching open files');
      return;
    }

    renderKeyedChildren(
      this.elements.openedFilesList,
      visibleItems,
      (item) => item.id,
      (item, existing) => {
        const row =
          existing && existing instanceof HTMLDivElement
            ? existing
            : createOpenedFileRow(item, this.callbacks, {
                onPointerEnter: (targetRow) => {
                  this.scheduleOpenedFileInfoTooltip(targetRow);
                },
                onPointerLeave: (targetRow) => {
                  if (this.openedFileInfoTooltipRow === targetRow) {
                    this.hideOpenedFileInfoTooltip();
                  }
                },
                onFocusIn: (targetRow) => {
                  if (this.consumeOpenedFileFocusTooltipSuppression(targetRow)) {
                    return;
                  }
                  this.showOpenedFileInfoTooltip(targetRow);
                },
                onFocusOut: (targetRow, relatedTarget) => {
                  if (relatedTarget instanceof Node && targetRow.contains(relatedTarget)) {
                    return;
                  }
                  if (this.openedFileInfoTooltipRow === targetRow) {
                    this.hideOpenedFileInfoTooltip();
                  }
                }
              });

        updateOpenedFileRow(row, item, {
          sizeText: formatFileSizeMb(item.sizeBytes ?? null),
          selected: item.id === this.openedImagesActiveId,
          selectionDisabled: selectionDisabled || item.selectable === false,
          actionDisabled: actionDisabled || item.selectable === false,
          editing: this.openedFileRenameState?.sessionId === item.id,
          dragging: this.openedImageDragState?.isDragging === true && this.openedImageDragState.sessionId === item.id,
          dropPlacement:
            this.openedImageDragState?.isDragging === true && this.openedImageDragState.dropTarget?.sessionId === item.id
              ? this.openedImageDragState.dropTarget.placement
              : null
        });
        return row;
      }
    );

    this.applyOpenedImageDragState();

    if (shouldRestoreFocus) {
      focusSelectedImageBrowserRow(this.elements.openedFilesList);
    }
  }

  private chooseOpenedImage(sessionId: string): void {
    if (this.disposed) {
      return;
    }

    if (!sessionId || this.elements.openedImagesSelect.disabled) {
      return;
    }

    if (this.openedImageItems.some((item) => item.id === sessionId && item.selectable === false)) {
      return;
    }

    this.elements.openedImagesSelect.value = sessionId;
    if (sessionId === this.openedImagesActiveId) {
      return;
    }

    this.openedImagesActiveId = sessionId;
    this.renderOpenedFileRows();
    this.callbacks.onOpenedImageSelected(sessionId);
  }

  private startOpenedFileRename(sessionId: string): void {
    if (this.disposed || !sessionId || this.isLoading || this.elements.openedImagesSelect.disabled) {
      return;
    }

    this.hideOpenedFileInfoTooltip();
    const item = this.openedImageItems.find((current) => current.id === sessionId);
    if (!item) {
      return;
    }

    this.finishOpenedImagesDrag();
    this.openedFileRenameState = {
      sessionId,
      initialLabel: item.label
    };
    this.renderOpenedFileRows();

    const input = this.getOpenedFileRenameInput(sessionId);
    input?.focus();
    input?.select();
  }

  private handleOpenedFileRenameInputKeyDown(event: KeyboardEvent): boolean {
    if (!isOpenedFileRenameInput(event.target)) {
      return false;
    }

    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitOpenedFileRename(event.target);
      return true;
    }

    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault();
      this.cancelOpenedFileRename();
      this.renderOpenedFileRows();
      focusSelectedImageBrowserRow(this.elements.openedFilesList);
      return true;
    }

    return true;
  }

  private commitActiveOpenedFileRename(): void {
    const input = this.elements.openedFilesList.querySelector<HTMLInputElement>('.opened-file-rename-input');
    if (input) {
      this.commitOpenedFileRename(input);
    }
  }

  private commitOpenedFileRename(input: HTMLInputElement): void {
    const renameState = this.openedFileRenameState;
    if (!renameState || input.dataset.sessionId !== renameState.sessionId) {
      return;
    }

    const nextDisplayName = input.value.trim();
    this.openedFileRenameState = null;

    if (nextDisplayName && nextDisplayName !== renameState.initialLabel.trim()) {
      this.callbacks.onOpenedImageDisplayNameChange(renameState.sessionId, nextDisplayName);
    }

    this.renderOpenedFileRows();
  }

  private cancelOpenedFileRename(): void {
    this.openedFileRenameState = null;
  }

  private getOpenedFileRenameInput(sessionId: string): HTMLInputElement | null {
    for (const row of this.elements.openedFilesList.querySelectorAll<HTMLElement>('.opened-file-row')) {
      if (row.dataset.sessionId === sessionId) {
        return row.querySelector<HTMLInputElement>('.opened-file-rename-input');
      }
    }

    return null;
  }

  private getVisibleOpenedImageItems(): OpenedImageOptionItem[] {
    const query = normalizeOpenedFilesFilterQuery(this.openedFilesFilterText);
    if (!query) {
      return this.openedImageItems;
    }

    return this.openedImageItems.filter((item) => (
      normalizeOpenedFilesFilterText(item.label).includes(query) ||
      normalizeOpenedFilesFilterText(item.sourceDetail ?? '').includes(query)
    ));
  }

  private setOpenedFilesFilterText(value: string): void {
    this.openedFilesFilterText = value;
    if (this.elements.openedFilesFilterInput.value !== value) {
      this.elements.openedFilesFilterInput.value = value;
    }
  }

  private handleOpenedFileDragStart(event: DragEvent): void {
    this.hideOpenedFileInfoTooltip();
    const row = findClosestListRow(event.target, 'sessionId');
    if (
      !row ||
      row.getAttribute('aria-disabled') === 'true' ||
      isNestedInteractiveListControl(event.target, row) ||
      this.isLoading ||
      this.elements.openedImagesSelect.disabled
    ) {
      event.preventDefault();
      return;
    }

    const sessionId = row.dataset.sessionId ?? '';
    const item = this.openedImageItems.find((current) => current.id === sessionId);
    if (!item || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    this.commitActiveOpenedFileRename();
    row.focus();
    this.callbacks.onOpenedImageRowClick();
    this.hideOpenedFileInfoTooltip();

    const dragImage = createOpenedFileDragImage(item);
    document.body.append(dragImage);

    this.openedImageDragState = {
      sessionId,
      lastTargetKey: null,
      dropTarget: null,
      isDragging: true,
      dragImage
    };
    this.elements.openedFilesList.classList.add('is-reordering');
    this.applyOpenedImageDragState();

    event.dataTransfer.effectAllowed = 'copyMove';
    safelySetDragData(event.dataTransfer, OPENED_FILE_DRAG_MIME, sessionId);
    safelySetDragData(event.dataTransfer, 'text/plain', item.label);
    safelySetDragImage(
      event.dataTransfer,
      dragImage,
      OPENED_FILE_DRAG_IMAGE_OFFSET_X,
      OPENED_FILE_DRAG_IMAGE_OFFSET_Y
    );
  }

  private handleOpenedFilesListDragOver(event: DragEvent): void {
    if (!this.canAcceptOpenedFileDrag(event)) {
      return;
    }

    const dragState = this.openedImageDragState!;
    const dropTarget = this.getOpenedImageDropTargetAtClientPoint(event.clientX, event.clientY);
    if (!dropTarget) {
      dragState.dropTarget = null;
      dragState.lastTargetKey = null;
      this.applyOpenedImageDragState();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    this.setOpenedFileViewerDropTarget(false);
    dragState.dropTarget = dropTarget;
    this.applyOpenedImageDragState();

    const targetKey = serializeOpenedImageDropTarget(dropTarget);
    if (targetKey === dragState.lastTargetKey) {
      return;
    }

    dragState.lastTargetKey = targetKey;
    if (dropTarget.sessionId === dragState.sessionId) {
      return;
    }

    this.callbacks.onReorderOpenedImage(dragState.sessionId, dropTarget.sessionId, dropTarget.placement);
  }

  private handleOpenedFilesListDragLeave(event: DragEvent): void {
    if (!this.openedImageDragState) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && this.elements.openedFilesList.contains(nextTarget)) {
      return;
    }

    this.openedImageDragState.dropTarget = null;
    this.openedImageDragState.lastTargetKey = null;
    this.applyOpenedImageDragState();
  }

  private handleOpenedFilesListDrop(event: DragEvent): void {
    if (!this.canAcceptOpenedFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.finishOpenedImagesDrag();
  }

  private handleViewerOpenedFileDragEnter(event: DragEvent): void {
    if (!this.canAcceptOpenedFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.clearOpenedFileReorderTarget();
    this.setOpenedFileViewerDropTarget(true);
  }

  private handleViewerOpenedFileDragOver(event: DragEvent): void {
    if (!this.canAcceptOpenedFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.clearOpenedFileReorderTarget();
    this.setOpenedFileViewerDropTarget(true);
  }

  private handleViewerOpenedFileDragLeave(event: DragEvent): void {
    if (!this.openedImageDragState) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && this.elements.viewerContainer.contains(nextTarget)) {
      return;
    }

    this.setOpenedFileViewerDropTarget(false);
  }

  private handleViewerOpenedFileDrop(event: DragEvent): void {
    if (!this.canAcceptOpenedFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const sessionId = this.openedImageDragState?.sessionId ?? '';
    const { clientX, clientY } = event;
    this.finishOpenedImagesDrag();
    this.callbacks.onOpenedImageDroppedToViewer(sessionId, clientX, clientY);
  }

  private finishOpenedImagesDrag(): void {
    this.hideOpenedFileInfoTooltip();
    const dragState = this.openedImageDragState;
    this.openedImageDragState = null;
    this.elements.openedFilesList.classList.remove('is-reordering');
    this.setOpenedFileViewerDropTarget(false);
    dragState?.dragImage?.remove();
    this.applyOpenedImageDragState();

    const activeId = this.openedImagesActiveId;
    if (dragState?.isDragging && activeId) {
      this.elements.openedImagesSelect.value = activeId;
    }

    if (dragState?.isDragging) {
      this.suppressOpenedImageSelectionUntilMs = performance.now() + 120;
    }
  }

  private applyOpenedImageDragState(): void {
    for (const row of this.elements.openedFilesList.querySelectorAll<HTMLElement>('.opened-file-row')) {
      const sessionId = row.dataset.sessionId ?? null;
      const dropPlacement =
        this.openedImageDragState?.isDragging === true &&
        sessionId &&
        this.openedImageDragState.dropTarget?.sessionId === sessionId
          ? this.openedImageDragState.dropTarget.placement
          : null;

      row.classList.toggle(
        'opened-file-row--dragging',
        this.openedImageDragState?.isDragging === true && sessionId === this.openedImageDragState.sessionId
      );
      row.classList.toggle('opened-file-row--drop-before', dropPlacement === 'before');
      row.classList.toggle('opened-file-row--drop-after', dropPlacement === 'after');
    }
  }

  private setOpenedFileViewerDropTarget(active: boolean): void {
    this.elements.viewerContainer.classList.toggle('is-opened-file-drop-target', active);
  }

  private clearOpenedFileReorderTarget(): void {
    if (!this.openedImageDragState) {
      return;
    }

    this.openedImageDragState.dropTarget = null;
    this.openedImageDragState.lastTargetKey = null;
    this.applyOpenedImageDragState();
  }

  private canAcceptOpenedFileDrag(event: DragEvent): boolean {
    const dragState = this.openedImageDragState;
    if (!dragState || this.isLoading || !this.openedImageItems.some((item) => item.id === dragState.sessionId)) {
      return false;
    }

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return true;
    }

    const types = Array.from(dataTransfer.types ?? []);
    return types.length === 0 || types.includes(OPENED_FILE_DRAG_MIME);
  }

  private getOpenedImageDropTargetAtClientPoint(clientX: number, clientY: number): OpenedImageDropTarget | null {
    const rows = getImageBrowserRows(this.elements.openedFilesList);
    if (rows.length === 0) {
      return null;
    }

    const listRect = this.elements.openedFilesList.getBoundingClientRect();
    if (
      listRect.height <= 0 ||
      listRect.width <= 0 ||
      clientX < listRect.left ||
      clientX > listRect.right ||
      clientY < listRect.top ||
      clientY > listRect.bottom
    ) {
      return null;
    }

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) {
        continue;
      }

      const sessionId = row.dataset.sessionId ?? null;
      if (!sessionId) {
        return null;
      }

      return {
        sessionId,
        placement: clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      };
    }

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const firstSessionId = firstRow?.dataset.sessionId ?? null;
    const lastSessionId = lastRow?.dataset.sessionId ?? null;
    if (!firstSessionId || !lastSessionId) {
      return null;
    }

    if (clientY < firstRow.getBoundingClientRect().top) {
      return {
        sessionId: firstSessionId,
        placement: 'before'
      };
    }

    return {
      sessionId: lastSessionId,
      placement: 'after'
    };
  }

  private scheduleOpenedFileInfoTooltip(row: HTMLDivElement): void {
    this.clearOpenedFileInfoTooltipTimer();
    this.openedFileInfoTooltipRow?.removeAttribute('aria-describedby');
    this.openedFileInfoTooltipRow = row;
    this.openedFileInfoTooltipTimer = window.setTimeout(() => {
      this.openedFileInfoTooltipTimer = null;
      if (this.openedFileInfoTooltipRow === row) {
        this.showOpenedFileInfoTooltip(row);
      }
    }, OPENED_FILE_INFO_TOOLTIP_DELAY_MS);
  }

  private showOpenedFileInfoTooltip(row: HTMLDivElement): void {
    if (this.disposed || this.isLoading || this.openedImageDragState?.isDragging || !row.isConnected) {
      this.hideOpenedFileInfoTooltip();
      return;
    }

    const item = this.getOpenedFileInfoTooltipItem(row);
    if (!item) {
      this.hideOpenedFileInfoTooltip();
      return;
    }

    this.clearOpenedFileInfoTooltipTimer();
    this.openedFileInfoTooltipRow?.removeAttribute('aria-describedby');
    this.openedFileInfoTooltipRow = row;

    const tooltip = this.ensureOpenedFileInfoTooltipElement();
    tooltip.replaceChildren(
      createOpenedFileInfoTooltipLine(item.label, 'opened-file-info-tooltip-filename'),
      createOpenedFileInfoTooltipLine(formatFileSizeMb(item.sizeBytes ?? null), 'opened-file-info-tooltip-size')
    );
    tooltip.hidden = false;
    row.setAttribute('aria-describedby', tooltip.id);
    positionOpenedFileInfoTooltip(row, tooltip);
  }

  private hideOpenedFileInfoTooltip(): void {
    this.clearOpenedFileInfoTooltipTimer();
    this.openedFileInfoTooltipRow?.removeAttribute('aria-describedby');
    this.openedFileInfoTooltipRow = null;
    this.openedFileInfoTooltipElement?.remove();
    this.openedFileInfoTooltipElement = null;
  }

  private repositionOpenedFileInfoTooltip(): void {
    if (!this.openedFileInfoTooltipRow || !this.openedFileInfoTooltipElement) {
      return;
    }

    if (!this.openedFileInfoTooltipRow.isConnected) {
      this.hideOpenedFileInfoTooltip();
      return;
    }

    positionOpenedFileInfoTooltip(this.openedFileInfoTooltipRow, this.openedFileInfoTooltipElement);
  }

  private clearOpenedFileInfoTooltipTimer(): void {
    if (this.openedFileInfoTooltipTimer === null) {
      return;
    }

    window.clearTimeout(this.openedFileInfoTooltipTimer);
    this.openedFileInfoTooltipTimer = null;
  }

  private suppressNextOpenedFileFocusTooltip(row: HTMLElement): void {
    this.suppressOpenedFileFocusTooltipRow = row;
    this.suppressOpenedFileFocusTooltipUntilMs = performance.now() + 120;
  }

  private consumeOpenedFileFocusTooltipSuppression(row: HTMLDivElement): boolean {
    if (
      this.suppressOpenedFileFocusTooltipRow !== row ||
      performance.now() > this.suppressOpenedFileFocusTooltipUntilMs
    ) {
      if (performance.now() > this.suppressOpenedFileFocusTooltipUntilMs) {
        this.suppressOpenedFileFocusTooltipRow = null;
        this.suppressOpenedFileFocusTooltipUntilMs = 0;
      }
      return false;
    }

    this.suppressOpenedFileFocusTooltipRow = null;
    this.suppressOpenedFileFocusTooltipUntilMs = 0;
    this.hideOpenedFileInfoTooltip();
    return true;
  }

  private ensureOpenedFileInfoTooltipElement(): HTMLDivElement {
    if (this.openedFileInfoTooltipElement) {
      return this.openedFileInfoTooltipElement;
    }

    const tooltip = document.createElement('div');
    tooltip.id = OPENED_FILE_INFO_TOOLTIP_ID;
    tooltip.className = 'opened-file-info-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);
    this.openedFileInfoTooltipElement = tooltip;
    return tooltip;
  }

  private getOpenedFileInfoTooltipItem(row: HTMLDivElement): OpenedImageOptionItem | null {
    const sessionId = row.dataset.sessionId ?? null;
    if (!sessionId) {
      return null;
    }

    return this.openedImageItems.find((item) => item.id === sessionId) ?? null;
  }
}

export function formatDisplayCacheUsageText(usedBytes: number, budgetBytes: number): string {
  return `${formatDisplayCacheMegabytes(usedBytes)} / ${formatDisplayCacheMegabytes(budgetBytes)} MB`;
}

export function getDisplayCacheUsageState(
  usedBytes: number,
  budgetBytes: number
): { text: string; overBudget: boolean } {
  return {
    text: formatDisplayCacheUsageText(usedBytes, budgetBytes),
    overBudget: usedBytes > budgetBytes
  };
}

export function getDisplayCacheMemoryUsageState(
  snapshot: MemoryUsageSnapshot,
  budgetBytes: number
): { retainedDisplayBytes: number; totalTrackedBytes: number; overBudget: boolean } {
  const retainedDisplayBytes = Math.max(0, snapshot.gpuTextureBytes) + Math.max(0, snapshot.cpuMaterializedBytes);
  return {
    retainedDisplayBytes,
    totalTrackedBytes: Math.max(0, snapshot.totalTrackedBytes),
    overBudget: retainedDisplayBytes > budgetBytes
  };
}

export function formatDisplayCacheBudgetLabel(
  preference: DisplayCacheBudgetPreference,
  budgetBytes: number
): string {
  const budgetText = `${formatDisplayCacheMegabytes(budgetBytes)} MB`;
  return preference.mode === 'fixed'
    ? `Fixed (${budgetText})`
    : `Automatic (${budgetText})`;
}

function createOpenedFileRow(
  item: OpenedImageOptionItem,
  callbacks: OpenedImagesPanelCallbacks,
  rowCallbacks: OpenedFileRowCallbacks
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'image-browser-row opened-file-row';
  row.addEventListener('pointerover', (event) => {
    const anchor = getOpenedFileInfoTooltipAnchor(event.target, row);
    if (!anchor) {
      rowCallbacks.onPointerLeave(row);
      return;
    }

    if (getOpenedFileInfoTooltipAnchor(event.relatedTarget, row) === anchor) {
      return;
    }

    rowCallbacks.onPointerEnter(row);
  });
  row.addEventListener('pointerout', (event) => {
    const anchor = getOpenedFileInfoTooltipAnchor(event.target, row);
    if (!anchor) {
      return;
    }

    if (getOpenedFileInfoTooltipAnchor(event.relatedTarget, row) === anchor) {
      return;
    }

    rowCallbacks.onPointerLeave(row);
  });
  row.addEventListener('focusin', () => {
    rowCallbacks.onFocusIn(row);
  });
  row.addEventListener('focusout', (event) => {
    rowCallbacks.onFocusOut(row, event.relatedTarget);
  });

  const thumbnail = createOpenedFileThumbnail(item.thumbnailDataUrl ?? null, item.thumbnailLoading === true);

  const label = document.createElement('span');
  label.className = 'image-browser-row-label opened-file-label';

  const actions = document.createElement('span');
  actions.className = 'opened-file-actions';

  const reloadButton = createOpenedFileActionButton({
    iconName: 'reload',
    onClick: () => {
      const sessionId = row.dataset.sessionId ?? item.id;
      if (row.dataset.retryable === 'true') {
        callbacks.onRetryPendingOpenedImageLoad(sessionId);
        return;
      }

      callbacks.onReloadSelectedOpenedImage(sessionId);
    }
  });
  const closeButton = createOpenedFileActionButton({
    iconName: 'close',
    onClick: () => {
      callbacks.onCloseSelectedOpenedImage(item.id);
    }
  });

  actions.append(reloadButton, closeButton);
  row.append(thumbnail, label, actions);
  openedFileRowRefs.set(row, { thumbnail, label, renameInput: null, reloadButton, closeButton });
  return row;
}

function getOpenedFileInfoTooltipAnchor(target: EventTarget | null, row: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest<HTMLElement>(OPENED_FILE_INFO_TOOLTIP_ANCHOR_SELECTOR);
  return anchor && row.contains(anchor) ? anchor : null;
}

function isOpenedFileLabelTarget(target: EventTarget | null, row: HTMLElement): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const label = target.closest<HTMLElement>('.opened-file-label');
  return label !== null && row.contains(label);
}

function createOpenedFileDragImage(item: OpenedImageOptionItem): HTMLDivElement {
  const dragImage = document.createElement('div');
  dragImage.className = 'opened-file-drag-image';
  dragImage.dataset.sessionId = item.id;
  dragImage.setAttribute('aria-hidden', 'true');

  const visual = document.createElement('span');
  visual.className = 'opened-file-drag-image-visual';
  if (item.thumbnailDataUrl) {
    const image = document.createElement('img');
    image.className = 'opened-file-drag-image-thumbnail';
    image.src = item.thumbnailDataUrl;
    image.alt = '';
    image.draggable = false;
    visual.append(image);
  } else {
    visual.append(createOpenedFileThumbnail(null, item.thumbnailLoading === true));
  }

  const label = document.createElement('span');
  label.className = 'opened-file-drag-image-label';
  label.textContent = item.label;

  dragImage.append(visual, label);
  return dragImage;
}

function getSelectableOpenedImageItems(items: OpenedImageOptionItem[]): OpenedImageOptionItem[] {
  return items.filter((item) => item.selectable !== false);
}

function normalizeOpenedFilesFilterQuery(value: string): string {
  return normalizeOpenedFilesFilterText(value.trim());
}

function normalizeOpenedFilesFilterText(value: string): string {
  return value.toLocaleLowerCase();
}

function updateOpenedFileRow(
  row: HTMLDivElement,
  item: OpenedImageOptionItem,
  options: {
    sizeText: string;
    selected: boolean;
    selectionDisabled: boolean;
    actionDisabled: boolean;
    editing: boolean;
    dragging: boolean;
    dropPlacement: OpenedImageDropPlacement | null;
  }
): void {
  const refs = openedFileRowRefs.get(row);
  if (!refs) {
    return;
  }

  row.dataset.sessionId = item.id;
  row.dataset.retryable = item.retryable === true ? 'true' : 'false';
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', options.selected ? 'true' : 'false');
  row.setAttribute('aria-disabled', options.selectionDisabled ? 'true' : 'false');
  if (item.thumbnailLoading === true) {
    row.setAttribute('aria-busy', 'true');
  } else {
    row.removeAttribute('aria-busy');
  }
  row.tabIndex = options.selectionDisabled ? -1 : 0;
  row.draggable = !options.actionDisabled && !options.editing;
  row.classList.toggle('opened-file-row--dragging', options.dragging);
  row.classList.toggle('opened-file-row--drop-before', options.dropPlacement === 'before');
  row.classList.toggle('opened-file-row--drop-after', options.dropPlacement === 'after');

  updateOpenedFileLabel(refs, item, options.editing, options.actionDisabled);

  const nextThumbnail = createOpenedFileThumbnail(item.thumbnailDataUrl ?? null, item.thumbnailLoading === true);
  if (!sameThumbnail(refs.thumbnail, nextThumbnail)) {
    row.replaceChild(nextThumbnail, refs.thumbnail);
    refs.thumbnail = nextThumbnail;
  }

  updateOpenedFileActionButton(refs.reloadButton, {
    iconName: 'reload',
    label: item.retryable === true ? `Retry ${item.label}` : `Reload ${item.label}`,
    disabled: options.actionDisabled && item.retryable !== true
  });
  updateOpenedFileActionButton(refs.closeButton, {
    iconName: 'close',
    label: `Close ${item.label}`,
    disabled: options.actionDisabled
  });
}

function updateOpenedFileLabel(
  refs: OpenedFileRowRefs,
  item: OpenedImageOptionItem,
  editing: boolean,
  disabled: boolean
): void {
  refs.label.classList.toggle('opened-file-label--editing', editing);
  if (!editing) {
    refs.renameInput = null;
    if (!item.statusText) {
      refs.label.textContent = item.label;
    } else {
      const name = document.createElement('span');
      name.className = 'opened-file-label-name';
      name.textContent = item.label;
      const status = document.createElement('span');
      status.className = 'opened-file-label-status';
      status.textContent = item.statusText;
      refs.label.replaceChildren(name, status);
    }
    refs.label.removeAttribute('title');
    return;
  }

  refs.label.removeAttribute('title');
  let input = refs.renameInput;
  if (!input || !refs.label.contains(input)) {
    input = createOpenedFileRenameInput(item);
    refs.renameInput = input;
    refs.label.replaceChildren(input);
  }

  input.disabled = disabled;
  input.dataset.sessionId = item.id;
  input.setAttribute('aria-label', `Rename ${item.label}`);
  input.title = `Rename ${item.label}`;
}

function createOpenedFileRenameInput(item: OpenedImageOptionItem): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'opened-file-rename-input';
  input.value = item.label;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.dataset.sessionId = item.id;
  input.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  input.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  return input;
}

function createOpenedFileActionButton(options: {
  iconName: 'reload' | 'close';
  onClick: () => void;
}): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `opened-file-action-button opened-file-action-button--${options.iconName}`;

  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    options.onClick();
  });

  return button;
}

function updateOpenedFileActionButton(
  button: HTMLButtonElement,
  options: {
    iconName: 'reload' | 'close';
    label: string;
    disabled: boolean;
  }
): void {
  button.disabled = options.disabled;
  button.setAttribute('aria-label', options.label);
  button.title = options.label;
  button.replaceChildren(createOpenedFileActionIcon(options.iconName));
}

function sameThumbnail(current: HTMLElement, next: HTMLElement): boolean {
  if (current.tagName !== next.tagName) {
    return false;
  }

  if (current instanceof HTMLImageElement && next instanceof HTMLImageElement) {
    return current.src === next.src;
  }

  return current.className === next.className;
}

function createOpenedFileActionIcon(iconName: 'reload' | 'close'): SVGSVGElement {
  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  if (iconName === 'reload') {
    const path = createSvgElement('path');
    path.setAttribute('d', 'M15.5 7.2A6 6 0 1 0 16 12');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '1.7');

    const arrow = createSvgElement('path');
    arrow.setAttribute('d', 'M15.5 3.6v3.6h-3.6');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-linecap', 'round');
    arrow.setAttribute('stroke-linejoin', 'round');
    arrow.setAttribute('stroke-width', '1.7');

    svg.append(path, arrow);
    return svg;
  }

  const first = createSvgElement('path');
  first.setAttribute('d', 'M5.8 5.8l8.4 8.4');
  first.setAttribute('fill', 'none');
  first.setAttribute('stroke', 'currentColor');
  first.setAttribute('stroke-linecap', 'round');
  first.setAttribute('stroke-width', '1.9');

  const second = createSvgElement('path');
  second.setAttribute('d', 'M14.2 5.8l-8.4 8.4');
  second.setAttribute('fill', 'none');
  second.setAttribute('stroke', 'currentColor');
  second.setAttribute('stroke-linecap', 'round');
  second.setAttribute('stroke-width', '1.9');

  svg.append(first, second);
  return svg;
}

function createOpenedFileThumbnail(thumbnailDataUrl: string | null, loading = false): HTMLElement {
  if (thumbnailDataUrl) {
    const image = document.createElement('img');
    image.className = 'opened-file-thumbnail';
    image.src = thumbnailDataUrl;
    image.alt = '';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  if (loading) {
    const indicator = document.createElement('span');
    indicator.className = 'opened-file-thumbnail-loading';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.title = 'Loading thumbnail';
    indicator.append(createOpenedFileThumbnailLoadingIcon());
    return indicator;
  }

  const icon = document.createElement('span');
  icon.className = 'file-row-icon';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function createOpenedFileThumbnailLoadingIcon(): SVGSVGElement {
  const svg = createSvgElement('svg');
  svg.classList.add('opened-file-thumbnail-loading-icon');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const arc = createSvgElement('path');
  arc.setAttribute('d', 'M15.5 9.8a5.6 5.6 0 1 1-2.4-4.6');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'currentColor');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-linejoin', 'round');
  arc.setAttribute('stroke-width', '2');

  const arrow = createSvgElement('path');
  arrow.setAttribute('d', 'M13 2.9l.6 2.9 2.8-.7');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  arrow.setAttribute('stroke-width', '2');

  svg.append(arc, arrow);
  return svg;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName) as SVGElementTagNameMap[K];
}

function isOpenedFileRenameInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.classList.contains('opened-file-rename-input');
}

function safelySetDragData(dataTransfer: DataTransfer, type: string, value: string): void {
  try {
    dataTransfer.setData(type, value);
  } catch {
    // Some browsers restrict custom drag data in edge cases; in-memory drag state remains authoritative.
  }
}

function safelySetDragImage(dataTransfer: DataTransfer, image: Element, x: number, y: number): void {
  try {
    dataTransfer.setDragImage(image, x, y);
  } catch {
    // Drag images are an affordance only; default browser drag feedback is acceptable as a fallback.
  }
}

function getOpenedFilesKeyboardReorderDelta(event: KeyboardEvent): -1 | 1 | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  return getVerticalArrowKeyDelta(event.key);
}

function isOpenedFilesKeyboardReorderCandidate(event: KeyboardEvent): boolean {
  return event.altKey && getVerticalArrowKeyDelta(event.key) !== null;
}

function getVerticalArrowKeyDelta(key: string): -1 | 1 | null {
  if (key === 'ArrowUp' || key === 'Up') {
    return -1;
  }

  if (key === 'ArrowDown' || key === 'Down') {
    return 1;
  }

  return null;
}

function serializeOpenedImageDropTarget(target: OpenedImageDropTarget): string {
  return `${target.sessionId}:${target.placement}`;
}

function createOpenedFileInfoTooltipLine(text: string, className: string): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = className;
  line.textContent = text;
  return line;
}

function positionOpenedFileInfoTooltip(row: HTMLElement, tooltip: HTMLElement): void {
  const rowRect = row.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || tooltipRect.width;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight || tooltipRect.height;
  const tooltipWidth = tooltipRect.width || 180;
  const tooltipHeight = tooltipRect.height || 44;
  const maxLeft = Math.max(
    OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX,
    viewportWidth - tooltipWidth - OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX
  );
  const maxTop = Math.max(
    OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX,
    viewportHeight - tooltipHeight - OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX
  );
  let left = rowRect.right + OPENED_FILE_INFO_TOOLTIP_GAP_PX;
  if (left + tooltipWidth > viewportWidth - OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX) {
    left = rowRect.left - tooltipWidth - OPENED_FILE_INFO_TOOLTIP_GAP_PX;
  }

  const top = rowRect.top + (rowRect.height - tooltipHeight) / 2;
  tooltip.style.left = `${clamp(left, OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX, maxLeft)}px`;
  tooltip.style.top = `${clamp(top, OPENED_FILE_INFO_TOOLTIP_VIEWPORT_MARGIN_PX, maxTop)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDisplayCacheMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0';
  }

  return Math.round(bytes / (1024 * 1024)).toString();
}

function formatFileSizeMb(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-- MB';
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
