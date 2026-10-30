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
  estimateReadingTimeRemaining,
  generateReadingNotesMarkdown,
  getNextPageNumber,
  getPrefetchPageNumber,
  getPreviousPageNumber,
  getVisiblePageNumbers,
  normalizeTargetPage,
  parseStudySheetJson,
  resetZoom,
  serializeStudySheetJson,
  stepZoomIn,
  stepZoomOut,
  togglePageBookmark,
  updateRollingReadingPace,
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
  readonly readingTimeSummary: string;
  readonly isCurrentPageBookmarked: boolean;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly goToNextPage: () => void;
  readonly goToPreviousPage: () => void;
  readonly goToPage: (pageNumber: number) => void;
  readonly setTheme: (theme: ReaderTheme) => void;
  readonly setViewMode: (viewMode: ReaderViewMode) => void;
  readonly toggleAutoCropMargins: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoomLevel: () => void;
  readonly toggleBookmarkOnCurrentPage: () => void;
  readonly toggleBookmarkOnPage: (pageNumber: number) => void;
  readonly addAnnotation: (note: string, color?: ReaderAnnotation['color']) => void;
  readonly removeAnnotation: (annotationId: string) => void;
  readonly exportNotesAsMarkdown: () => void;
  readonly exportNotesAsJson: () => void;
  readonly importNotesFromJson: (rawJson: string) => {
    readonly success: boolean;
    readonly message: string;
  };
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

  // Track timestamp when user arrived on the current page for reading speed calculation
  const pageEnteredAtRef = useRef<number>(Date.now());

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

        pageEnteredAtRef.current = Date.now();
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
      void repository.updateReadingProgress(latestSessionRef.current);

      if (activeHandleRef.current) {
        const handleToDestroy = activeHandleRef.current;
        activeHandleRef.current = null;
        void handleToDestroy.destroy();
      }
    };
  }, [bookId, repository, pdfEngine]);

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

  const recordDwellAndNavigate = useCallback(
    (computeNextPage: (prev: ReadingSession) => number) => {
      const now = Date.now();
      const dwellSeconds = (now - pageEnteredAtRef.current) / 1000;
      pageEnteredAtRef.current = now;

      updateSession((prev) => {
        const nextPage = computeNextPage(prev);
        const updatedPace =
          nextPage !== prev.currentPage
            ? updateRollingReadingPace(prev.averageSecondsPerPage, dwellSeconds)
            : prev.averageSecondsPerPage;
        return {
          ...prev,
          currentPage: nextPage,
          averageSecondsPerPage: updatedPace,
        };
      });
    },
    [updateSession]
  );

  const goToPage = useCallback(
    (targetPage: number) => {
      recordDwellAndNavigate((prev) =>
        normalizeTargetPage(targetPage, totalPages, prev.viewMode)
      );
    },
    [totalPages, recordDwellAndNavigate]
  );

  const goToNextPage = useCallback(() => {
    recordDwellAndNavigate((prev) =>
      getNextPageNumber(prev.currentPage, totalPages, prev.viewMode)
    );
  }, [totalPages, recordDwellAndNavigate]);

  const goToPreviousPage = useCallback(() => {
    recordDwellAndNavigate((prev) =>
      getPreviousPageNumber(prev.currentPage, totalPages, prev.viewMode)
    );
  }, [totalPages, recordDwellAndNavigate]);

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

  const toggleAutoCropMargins = useCallback(() => {
    updateSession((prev) => ({
      ...prev,
      autoCropMargins: !prev.autoCropMargins,
    }));
  }, [updateSession]);

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

  const triggerBrowserDownload = useCallback(
    (content: string, filename: string, mimeType: string) => {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    },
    []
  );

  const exportNotesAsMarkdown = useCallback(() => {
    if (readerState.status !== 'success') return;
    const { book, outline } = readerState.data;
    const markdown = generateReadingNotesMarkdown(
      book,
      session.bookmarks,
      session.annotations,
      outline
    );
    const safeSlug = book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    triggerBrowserDownload(
      markdown,
      `fiche-lecture-${safeSlug || 'folio'}.md`,
      'text/markdown;charset=utf-8'
    );
  }, [readerState, session.bookmarks, session.annotations, triggerBrowserDownload]);

  const exportNotesAsJson = useCallback(() => {
    if (readerState.status !== 'success') return;
    const { book } = readerState.data;
    const json = serializeStudySheetJson(
      book.title,
      session.bookmarks,
      session.annotations
    );
    const safeSlug = book.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    triggerBrowserDownload(
      json,
      `notes-${safeSlug || 'folio'}.json`,
      'application/json;charset=utf-8'
    );
  }, [readerState, session.bookmarks, session.annotations, triggerBrowserDownload]);

  const importNotesFromJson = useCallback(
    (rawJson: string): { readonly success: boolean; readonly message: string } => {
      try {
        const imported = parseStudySheetJson(rawJson, totalPages);
        updateSession((prev) => {
          const mergedBookmarks = Array.from(
            new Set([...prev.bookmarks, ...imported.bookmarks])
          ).sort((a, b) => a - b);

          const existingIds = new Set(prev.annotations.map((a) => a.id));
          const newNotes = imported.annotations.filter(
            (a) => !existingIds.has(a.id)
          );

          return {
            ...prev,
            bookmarks: mergedBookmarks,
            annotations: [...newNotes, ...prev.annotations],
          };
        });
        return {
          success: true,
          message: `${imported.bookmarks.length} signet(s) et ${imported.annotations.length} note(s) importés avec succès.`,
        };
      } catch {
        return {
          success: false,
          message:
            'Le fichier JSON sélectionné ne correspond pas au format de fiche de lecture Folio.',
        };
      }
    },
    [totalPages, updateSession]
  );

  // Keyboard shortcuts: ArrowRight / Space -> next page, ArrowLeft -> previous page, B -> bookmark, C -> Auto-crop
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
      } else if (event.key === 'c' || event.key === 'C') {
        if (!event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          toggleAutoCropMargins();
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
    toggleAutoCropMargins,
  ]);

  const visiblePages = getVisiblePageNumbers(
    session.currentPage,
    totalPages,
    session.viewMode
  );
  const lastVisiblePage =
    visiblePages[visiblePages.length - 1] ?? session.currentPage;

  const progressPercentage = calculateProgressPercentage(
    lastVisiblePage,
    totalPages
  );
  const remainingPercentage = calculateRemainingPercentage(
    lastVisiblePage,
    totalPages
  );

  const outline =
    readerState.status === 'success' ? readerState.data.outline : [];

  const readingTimeSummary = estimateReadingTimeRemaining(
    lastVisiblePage,
    totalPages,
    outline,
    session.averageSecondsPerPage
  ).formattedSummary;

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
    readingTimeSummary,
    isCurrentPageBookmarked,
    canGoPrevious,
    canGoNext,
    goToNextPage,
    goToPreviousPage,
    goToPage,
    setTheme,
    setViewMode,
    toggleAutoCropMargins,
    zoomIn,
    zoomOut,
    resetZoomLevel,
    toggleBookmarkOnCurrentPage,
    toggleBookmarkOnPage,
    addAnnotation,
    removeAnnotation,
    exportNotesAsMarkdown,
    exportNotesAsJson,
    importNotesFromJson,
  };
}
