/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppError,
  AsyncState,
  createAppError,
} from '../domain/entities/AsyncState';
import { Book } from '../domain/entities/Book';
import {
  createInitialReadingSession,
  ReaderAnnotation,
  ReaderTheme,
  ReaderViewMode,
  ReadingSession,
} from '../domain/entities/ReadingSession';
import { IBookRepository } from '../domain/repositories/IBookRepository';
import {
  IPdfDocumentHandle,
  IPdfEngine,
  PdfOutlineItem,
} from '../domain/services/IPdfEngine';
import {
  calculateProgressPercentage,
  calculateRemainingPercentage,
  clampZoomLevel,
  getNextPageNumber,
  getPrefetchPageNumber,
  getPreviousPageNumber,
  getVisiblePageNumbers,
  normalizeTargetPage,
  resetZoom,
  stepZoomIn,
  stepZoomOut,
  togglePageBookmark,
} from '../domain/services/ReadingRules';

const PROGRESS_SAVE_DEBOUNCE_MS = 350;

export interface LoadedReaderData {
  readonly book: Book;
  readonly documentHandle: IPdfDocumentHandle;
  readonly outline: readonly PdfOutlineItem[];
}

export interface UseReaderResult {
  readonly readerState: AsyncState<LoadedReaderData>;
  readonly session: ReadingSession;
  readonly visiblePages: readonly number[];
  readonly progressPercentage: number;
  readonly remainingPercentage: number;
  readonly isCurrentPageBookmarked: boolean;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly goToNextPage: () => void;
  readonly goToPreviousPage: () => void;
  readonly goToPage: (pageNumber: number) => void;
  readonly setTheme: (theme: ReaderTheme) => void;
  readonly setViewMode: (viewMode: ReaderViewMode) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoomLevel: () => void;
  readonly toggleBookmarkOnCurrentPage: () => void;
  readonly toggleBookmarkOnPage: (pageNumber: number) => void;
  readonly addAnnotation: (note: string, color?: ReaderAnnotation['color']) => void;
  readonly removeAnnotation: (annotationId: string) => void;
}

export function useReader(
  bookId: string,
  repository: IBookRepository,
  pdfEngine: IPdfEngine
): UseReaderResult {
  const [readerState, setReaderState] = useState<AsyncState<LoadedReaderData>>({
    status: 'loading',
    message: 'Ouverture de l’ouvrage et préparation du rendu haute résolution…',
  });

  const [session, setSession] = useState<ReadingSession>(() =>
    createInitialReadingSession(bookId)
  );

  const activeHandleRef = useRef<IPdfDocumentHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestSessionRef = useRef<ReadingSession>(session);
  latestSessionRef.current = session;

  // Load book metadata, reading session, and binary PDF document
  useEffect(() => {
    let isCancelled = false;

    async function loadBookAndSession() {
      setReaderState({
        status: 'loading',
        message: 'Ouverture de l’ouvrage…',
      });

      try {
        const [bookMeta, blob, savedSession] = await Promise.all([
          repository.getBookMetadata(bookId),
          repository.getBookBlob(bookId),
          repository.getReadingSession(bookId),
        ]);

        if (!bookMeta || !blob) {
          throw createAppError(
            'BOOK_NOT_FOUND',
            'Ouvrage introuvable',
            'Ce livre a été supprimé ou n’est plus présent dans le stockage local.'
          );
        }

        const docHandle = await pdfEngine.loadDocument(blob);

        if (isCancelled) {
          await docHandle.destroy();
          return;
        }

        const outline = await docHandle.extractOutline();

        if (isCancelled) {
          await docHandle.destroy();
          return;
        }

        activeHandleRef.current = docHandle;

        const normalizedStartPage = normalizeTargetPage(
          savedSession.currentPage,
          docHandle.totalPages,
          savedSession.viewMode
        );

        const hydratedSession: ReadingSession = {
          ...savedSession,
          currentPage: normalizedStartPage,
        };

        setSession(hydratedSession);
        setReaderState({
          status: 'success',
          data: {
            book: bookMeta,
            documentHandle: docHandle,
            outline,
          },
        });
      } catch (err: unknown) {
        if (isCancelled) return;
        const appErr: AppError =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          'title' in err &&
          'message' in err
            ? (err as AppError)
            : createAppError(
                'CORRUPTED_PDF',
                'Impossible d’ouvrir le livre',
                err instanceof Error
                  ? err.message
                  : 'Une erreur est survenue lors du chargement du PDF.'
              );
        setReaderState({ status: 'error', error: appErr });
      }
    }

    void loadBookAndSession();

    return () => {
      isCancelled = true;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Flush latest reading session immediately on unmount
      void repository.updateReadingProgress(latestSessionRef.current);

      if (activeHandleRef.current) {
        const handleToDestroy = activeHandleRef.current;
        activeHandleRef.current = null;
        void handleToDestroy.destroy();
      }
    };
  }, [bookId, repository, pdfEngine]);

  // Debounced auto-save of reading session + prefetch page N+1
  const scheduleSessionPersistence = useCallback(
    (nextSession: ReadingSession) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void repository.updateReadingProgress(nextSession);
        saveTimerRef.current = null;
      }, PROGRESS_SAVE_DEBOUNCE_MS);
    },
    [repository]
  );

  const totalPages =
    readerState.status === 'success'
      ? readerState.data.documentHandle.totalPages
      : 1;

  // Prefetch page N+1 whenever currentPage or viewMode changes
  useEffect(() => {
    if (readerState.status !== 'success') return;
    const prefetchPage = getPrefetchPageNumber(
      session.currentPage,
      readerState.data.documentHandle.totalPages,
      session.viewMode
    );
    if (prefetchPage !== null) {
      void readerState.data.documentHandle.prefetchPage(prefetchPage);
    }
  }, [readerState, session.currentPage, session.viewMode]);

  const updateSession = useCallback(
    (updater: (prev: ReadingSession) => ReadingSession) => {
      setSession((prev) => {
        const updated = updater(prev);
        scheduleSessionPersistence(updated);
        return updated;
      });
    },
    [scheduleSessionPersistence]
  );

  const goToPage = useCallback(
    (targetPage: number) => {
      updateSession((prev) => ({
        ...prev,
        currentPage: normalizeTargetPage(targetPage, totalPages, prev.viewMode),
      }));
    },
    [totalPages, updateSession]
  );

  const goToNextPage = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      currentPage: getNextPageNumber(
        prev.currentPage,
        totalPages,
        prev.viewMode
      ),
    }));
  }, [totalPages, updateSession]);

  const goToPreviousPage = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      currentPage: getPreviousPageNumber(
        prev.currentPage,
        totalPages,
        prev.viewMode
      ),
    }));
  }, [totalPages, updateSession]);

  const setTheme = useCallback(
    (theme: ReaderTheme) => {
      updateSession((prev) => ({ ...prev, theme }));
    },
    [updateSession]
  );

  const setViewMode = useCallback(
    (viewMode: ReaderViewMode) => {
      updateSession((prev) => ({
        ...prev,
        viewMode,
        currentPage: normalizeTargetPage(
          prev.currentPage,
          totalPages,
          viewMode
        ),
      }));
    },
    [totalPages, updateSession]
  );

  const zoomIn = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      zoomLevel: stepZoomIn(prev.zoomLevel),
    }));
  }, [updateSession]);

  const zoomOut = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      zoomLevel: stepZoomOut(prev.zoomLevel),
    }));
  }, [updateSession]);

  const resetZoomLevel = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      zoomLevel: resetZoom(),
    }));
  }, [updateSession]);

  const toggleBookmarkOnPage = useCallback(
    (pageNumber: number) => {
      const clamped = Math.max(1, Math.min(pageNumber, totalPages));
      updateSession((prev) => ({
        ...prev,
        bookmarks: togglePageBookmark(prev.bookmarks, clamped),
      }));
    },
    [totalPages, updateSession]
  );

  const toggleBookmarkOnCurrentPage = useCallback(() => {
    toggleBookmarkOnPage(session.currentPage);
  }, [session.currentPage, toggleBookmarkOnPage]);

  const addAnnotation = useCallback(
    (note: string, color: ReaderAnnotation['color'] = 'amber') => {
      const trimmed = note.trim();
      if (!trimmed) return;
      const newAnnotation: ReaderAnnotation = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNumber: session.currentPage,
        note: trimmed,
        createdAt: Date.now(),
        color,
      };
      updateSession((prev) => ({
        ...prev,
        annotations: [newAnnotation, ...prev.annotations],
      }));
    },
    [session.currentPage, updateSession]
  );

  const removeAnnotation = useCallback(
    (annotationId: string) => {
      updateSession((prev) => ({
        ...prev,
        annotations: prev.annotations.filter((a) => a.id !== annotationId),
      }));
    },
    [updateSession]
  );

  // Keyboard shortcuts: ArrowRight / Space -> next page, ArrowLeft -> previous page
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToNextPage();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPreviousPage();
      } else if (event.key === ' ') {
        event.preventDefault();
        if (event.shiftKey) {
          goToPreviousPage();
        } else {
          goToNextPage();
        }
      } else if (event.key === '+' || event.key === '=') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          zoomIn();
        }
      } else if (event.key === '-') {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          zoomOut();
        }
      } else if (event.key === 'b' || event.key === 'B') {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          toggleBookmarkOnCurrentPage();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    goToNextPage,
    goToPreviousPage,
    zoomIn,
    zoomOut,
    toggleBookmarkOnCurrentPage,
  ]);

  const visiblePages = getVisiblePageNumbers(
    session.currentPage,
    totalPages,
    session.viewMode
  );
  const lastVisiblePage = visiblePages[visiblePages.length - 1] ?? session.currentPage;

  const progressPercentage = calculateProgressPercentage(
    lastVisiblePage,
    totalPages
  );
  const remainingPercentage = calculateRemainingPercentage(
    lastVisiblePage,
    totalPages
  );

  const isCurrentPageBookmarked = visiblePages.some((p) =>
    session.bookmarks.includes(p)
  );

  const canGoPrevious = session.currentPage > 1;
  const canGoNext = lastVisiblePage < totalPages;

  return {
    readerState,
    session,
    visiblePages,
    progressPercentage,
    remainingPercentage,
    isCurrentPageBookmarked,
    canGoPrevious,
    canGoNext,
    goToNextPage,
    goToPreviousPage,
    goToPage,
    setTheme,
    setViewMode,
    zoomIn,
    zoomOut,
    resetZoomLevel,
    toggleBookmarkOnCurrentPage,
    toggleBookmarkOnPage,
    addAnnotation,
    removeAnnotation,
  };
}
