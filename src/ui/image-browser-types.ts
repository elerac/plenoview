import type { ExrMetadataEntry, PendingOpenedImageStatus } from '../types';

export interface OpenedImageOptionItem {
  id: string;
  label: string;
  sizeBytes?: number | null;
  sourceDetail?: string;
  metadata?: ExrMetadataEntry[] | null;
  thumbnailDataUrl?: string | null;
  thumbnailAspectRatio?: number | null;
  thumbnailLoading?: boolean;
  selectable?: boolean;
  loadStatus?: PendingOpenedImageStatus;
  statusText?: string;
  retryable?: boolean;
}

export interface LayerOptionItem {
  index: number;
  label: string;
  channelCount?: number;
  selectable?: boolean;
}
