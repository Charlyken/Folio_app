/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_ZOOM_LEVEL,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  ReaderViewMode,
  ZOOM_STEP,
} from '../entities/ReadingSession';

export const MAX_PDF_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB
export const ALLOWED_PDF_MIME_TYPE = 'application/pdf';

/**
 * Calculates the reading progress percentage between 0 and 100.
 */
export function calculateProgressPercentage(currentPage: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages));
  if (totalPages === 1) return 100;
  return Math.round((clampedPage / totalPages) * 100);
}

/**
 * Calculates the remaining percentage of the book.
 */
export function calculateRemainingPercentage(currentPage: number, totalPages: number): number {
  const progress = calculateProgressPercentage(currentPage, totalPages);
  return Math.max(0, 100 - progress);
}

/**
 * Clamps a target page number within valid [1, totalPages] bounds.
 * In double-page mode, aligns spread pages cleanly (page 1 is solo cover or 1-2 spread).
 * Here we align spreads as [1, 2], [3, 4], [5, 6] so odd pages are always on the left.
 */
export function normalizeTargetPage(
  targetPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number {
  if (totalPages <= 0) return 1;
  const clamped = Math.max(1, Math.min(Math.floor(targetPage), totalPages));
  if (viewMode === 'double' && clamped > 1 && clamped % 2 === 0) {
    return clamped - 1;
  }
  return clamped;
}

/**
 * Computes the next page number based on current page, total pages, and viewMode.
 */
export function getNextPageNumber(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number {
  const step = viewMode === 'double' ? 2 : 1;
  const candidate = currentPage + step;
  if (candidate > totalPages) {
    return normalizeTargetPage(totalPages, totalPages, viewMode);
  }
  return normalizeTargetPage(candidate, totalPages, viewMode);
}

/**
 * Computes the previous page number based on current page, total pages, and viewMode.
 */
export function getPreviousPageNumber(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number {
  const step = viewMode === 'double' ? 2 : 1;
  const candidate = currentPage - step;
  return normalizeTargetPage(Math.max(1, candidate), totalPages, viewMode);
}

/**
 * Returns the pair of pages currently visible in the reader.
 * In 'single' mode: [currentPage]
 * In 'double' mode: [leftPage, rightPage] if rightPage <= totalPages, else [leftPage]
 */
export function getVisiblePageNumbers(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): readonly number[] {
  const normalized = normalizeTargetPage(currentPage, totalPages, viewMode);
  if (viewMode === 'single') {
    return [normalized];
  }
  const secondPage = normalized + 1;
  if (secondPage <= totalPages) {
    return [normalized, secondPage];
  }
  return [normalized];
}

/**
 * Computes the next page to prefetch in memory (N+1 in single mode, or next spread's first page in double mode).
 */
export function getPrefetchPageNumber(
  currentPage: number,
  totalPages: number,
  viewMode: ReaderViewMode
): number | null {
  const visible = getVisiblePageNumbers(currentPage, totalPages, viewMode);
  const lastVisible = visible[visible.length - 1];
  if (lastVisible !== undefined && lastVisible + 1 <= totalPages) {
    return lastVisible + 1;
  }
  return null;
}

/**
 * Toggles a page number in the sorted list of bookmarks.
 */
export function togglePageBookmark(
  bookmarks: readonly number[],
  pageNumber: number
): readonly number[] {
  const exists = bookmarks.includes(pageNumber);
  if (exists) {
    return bookmarks.filter((p) => p !== pageNumber);
  }
  return [...bookmarks, pageNumber].sort((a, b) => a - b);
}

/**
 * Clamps and rounds zoom level within [MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL].
 */
export function clampZoomLevel(zoom: number): number {
  const clamped = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, zoom));
  return Math.round(clamped * 100) / 100;
}

export function stepZoomIn(currentZoom: number): number {
  return clampZoomLevel(currentZoom + ZOOM_STEP);
}

export function stepZoomOut(currentZoom: number): number {
  return clampZoomLevel(currentZoom - ZOOM_STEP);
}

export function resetZoom(): number {
  return DEFAULT_ZOOM_LEVEL;
}

/**
 * Formats byte size into human-readable French string (e.g., "2,4 Mo").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} Ko`;
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace('.', ',')} Mo`;
}
