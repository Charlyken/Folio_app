/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Highlighter,
  MessageSquarePlus,
  Trash2,
  X,
} from 'lucide-react';
import {
  HighlightColor,
  HighlightRect,
  ReaderHighlight,
  ReaderTheme,
  ReaderViewMode,
} from '../../../domain/entities/ReadingSession';
import {
  IPdfDocumentHandle,
  PdfTextSpanItem,
} from '../../../domain/services/IPdfEngine';

export interface ReaderCanvasProps {
  readonly documentHandle: IPdfDocumentHandle;
  readonly bookTitle: string;
  readonly bookAuthor: string;
  readonly visiblePages: readonly number[];
  readonly zoomLevel: number;
  readonly theme: ReaderTheme;
  readonly viewMode: ReaderViewMode;
  readonly autoCropMargins: boolean;
  readonly highlights: readonly ReaderHighlight[];
  readonly activeSearchQuery: string;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly onPreviousPage: () => void;
  readonly onNextPage: () => void;
  readonly onCenterTap: () => void;
  readonly onAddHighlight: (
    pageNumber: number,
    text: string,
    color: HighlightColor,
    rects: readonly HighlightRect[]
  ) => void;
  readonly onRemoveHighlight: (highlightId: string) => void;
  readonly onAddQuotedNote: (
    note: string,
    color: HighlightColor,
    quotedText: string,
    pageNumber: number
  ) => void;
}

interface ActiveTextSelection {
  readonly pageNumber: number;
  readonly text: string;
  readonly rects: readonly HighlightRect[];
  readonly popoverX: number;
  readonly popoverY: number;
}

const BASE_PAGE_SCALE_SINGLE = 0.88;
const BASE_PAGE_SCALE_DOUBLE = 0.78;

function getCanvasThemeFilterClass(theme: ReaderTheme): string {
  switch (theme) {
    case 'light':
      return 'brightness-100 contrast-100';
    case 'sepia':
      return 'sepia-[.28] brightness-[0.97] contrast-[0.96]';
    case 'dark':
      return 'invert-[0.90] hue-rotate-180 contrast-[0.92] brightness-[0.95]';
  }
}

function getHighlightBgClass(color: HighlightColor): string {
  switch (color) {
    case 'amber':
      return 'bg-amber-400/40 border-b border-amber-500/60';
    case 'terracotta':
      return 'bg-[#9A3412]/30 border-b border-[#9A3412]/60';
    case 'lapis':
      return 'bg-blue-500/30 border-b border-blue-600/60';
  }
}

export const ReaderCanvas: React.FC<ReaderCanvasProps> = ({
  documentHandle,
  bookTitle,
  bookAuthor,
  visiblePages,
  zoomLevel,
  theme,
  viewMode,
  autoCropMargins,
  highlights,
  activeSearchQuery,
  canGoPrevious,
  canGoNext,
  onPreviousPage,
  onNextPage,
  onCenterTap,
  onAddHighlight,
  onRemoveHighlight,
  onAddQuotedNote,
}) => {
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const leftLayerRef = useRef<HTMLDivElement | null>(null);
  const rightLayerRef = useRef<HTMLDivElement | null>(null);

  const [renderError, setRenderError] = useState<string | null>(null);
  const [leftTextSpans, setLeftTextSpans] = useState<readonly PdfTextSpanItem[]>([]);
  const [rightTextSpans, setRightTextSpans] = useState<readonly PdfTextSpanItem[]>([]);
  const [activeSelection, setActiveSelection] =
    useState<ActiveTextSelection | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState<boolean>(false);
  const [isNotePromptOpen, setIsNotePromptOpen] = useState<boolean>(false);
  const [quoteNoteInput, setQuoteNoteInput] = useState<string>('');

  const leftPageNumber = visiblePages[0] ?? 1;
  const rightPageNumber =
    viewMode === 'double' && visiblePages.length > 1 ? visiblePages[1] : null;

  const baseScale =
    viewMode === 'double' ? BASE_PAGE_SCALE_DOUBLE : BASE_PAGE_SCALE_SINGLE;
  const effectiveScale = baseScale * zoomLevel;

  // Clear selection when page or view changes
  useEffect(() => {
    setActiveSelection(null);
    setIsNotePromptOpen(false);
    setQuoteNoteInput('');
  }, [leftPageNumber, rightPageNumber, viewMode, autoCropMargins, zoomLevel]);

  // Render Left (or Single) Page + Extract Aligned Vector TextLayer Spans
  useEffect(() => {
    const canvas = leftCanvasRef.current;
    if (!canvas) return;

    let isCancelled = false;
    setRenderError(null);

    void Promise.all([
      documentHandle.renderPageToCanvas({
        pageNumber: leftPageNumber,
        canvas,
        scale: effectiveScale,
        autoCropMargins,
      }),
      documentHandle.getPageTextItems(leftPageNumber, autoCropMargins),
    ])
      .then(([, spans]) => {
        if (!isCancelled) {
          setLeftTextSpans(spans);
        }
      })
      .catch((err: unknown) => {
        if (isCancelled) return;
        const msg =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Erreur de rendu graphique.';
        setRenderError(msg);
      });

    return () => {
      isCancelled = true;
      documentHandle.cancelActiveRender(canvas);
    };
  }, [documentHandle, leftPageNumber, effectiveScale, autoCropMargins]);

  // Render Right Page in Double-Page Book Spread Mode + Extract Vector TextLayer Spans
  useEffect(() => {
    const canvas = rightCanvasRef.current;
    if (!canvas) return;

    if (rightPageNumber === null) {
      documentHandle.cancelActiveRender(canvas);
      canvas.width = 0;
      canvas.height = 0;
      setRightTextSpans([]);
      return;
    }

    let isCancelled = false;

    void Promise.all([
      documentHandle.renderPageToCanvas({
        pageNumber: rightPageNumber,
        canvas,
        scale: effectiveScale,
        autoCropMargins,
      }),
      documentHandle.getPageTextItems(rightPageNumber, autoCropMargins),
    ])
      .then(([, spans]) => {
        if (!isCancelled) {
          setRightTextSpans(spans);
        }
      })
      .catch(() => {
        if (isCancelled) return;
      });

    return () => {
      isCancelled = true;
      documentHandle.cancelActiveRender(canvas);
    };
  }, [documentHandle, rightPageNumber, effectiveScale, autoCropMargins]);

  // Clean up canvas pixel buffers on unmount
  useEffect(() => {
    const leftCanvas = leftCanvasRef.current;
    const rightCanvas = rightCanvasRef.current;
    return () => {
      if (leftCanvas) {
        documentHandle.cancelActiveRender(leftCanvas);
        leftCanvas.width = 0;
        leftCanvas.height = 0;
      }
      if (rightCanvas) {
        documentHandle.cancelActiveRender(rightCanvas);
        rightCanvas.width = 0;
        rightCanvas.height = 0;
      }
    };
  }, [documentHandle]);

  const handleTextSelectionEnd = useCallback(
    (
      pageNumber: number,
      layerContainer: HTMLDivElement | null,
      event: React.MouseEvent<HTMLDivElement>
    ) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !layerContainer) {
        return;
      }

      const selectedText = sel.toString().replace(/\s+/g, ' ').trim();
      if (selectedText.length < 2) {
        return;
      }

      const containerRect = layerContainer.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) {
        return;
      }

      const range = sel.getRangeAt(0);
      const clientRects = Array.from(range.getClientRects());
      const normalizedRects: HighlightRect[] = [];

      for (const r of clientRects) {
        if (r.width < 2 || r.height < 2) continue;
        const xRatio = Math.max(
          0,
          Math.min(1, (r.left - containerRect.left) / containerRect.width)
        );
        const yRatio = Math.max(
          0,
          Math.min(1, (r.top - containerRect.top) / containerRect.height)
        );
        const widthRatio = Math.max(
          0.005,
          Math.min(1 - xRatio, r.width / containerRect.width)
        );
        const heightRatio = Math.max(
          0.005,
          Math.min(1 - yRatio, r.height / containerRect.height)
        );
        normalizedRects.push({
          xRatio,
          yRatio,
          widthRatio,
          heightRatio,
        });
      }

      if (normalizedRects.length === 0) {
        return;
      }

      event.stopPropagation();
      const firstRect = clientRects[0] ?? containerRect;
      setActiveSelection({
        pageNumber,
        text: selectedText,
        rects: normalizedRects,
        popoverX: Math.max(
          160,
          Math.min(window.innerWidth - 160, firstRect.left + firstRect.width / 2)
        ),
        popoverY: Math.max(76, firstRect.top - 12),
      });
      setCopiedFeedback(false);
      setIsNotePromptOpen(false);
    },
    []
  );

  const handleApplyHighlight = useCallback(
    (color: HighlightColor) => {
      if (!activeSelection) return;
      onAddHighlight(
        activeSelection.pageNumber,
        activeSelection.text,
        color,
        activeSelection.rects
      );
      window.getSelection()?.removeAllRanges();
      setActiveSelection(null);
    },
    [activeSelection, onAddHighlight]
  );

  const handleCopyFormattedCitation = useCallback(async () => {
    if (!activeSelection) return;
    const formatted = `« ${activeSelection.text} » — ${bookAuthor}, ${bookTitle}, p. ${activeSelection.pageNumber}`;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedFeedback(true);
    } catch {
      setCopiedFeedback(true);
    }
  }, [activeSelection, bookAuthor, bookTitle]);

  const handleSaveQuotedNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSelection || !quoteNoteInput.trim()) return;
    onAddQuotedNote(
      quoteNoteInput.trim(),
      'amber',
      activeSelection.text,
      activeSelection.pageNumber
    );
    window.getSelection()?.removeAllRanges();
    setActiveSelection(null);
    setIsNotePromptOpen(false);
    setQuoteNoteInput('');
  };

  const handlePageContainerClick = useCallback(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
      return;
    }
    if (activeSelection) {
      setActiveSelection(null);
      return;
    }
    onCenterTap();
  }, [activeSelection, onCenterTap]);

  const filterClass = getCanvasThemeFilterClass(theme);
  const normalizedSearchNeedle = activeSearchQuery
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const renderPageOverlays = (
    pageNumber: number,
    spans: readonly PdfTextSpanItem[],
    layerRef: React.RefObject<HTMLDivElement | null>
  ) => {
    const pageHighlights = highlights.filter((h) => h.pageNumber === pageNumber);

    return (
      <>
        {/* 1. Saved Ink Highlights Layer */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10"
        >
          {pageHighlights.map((hl) =>
            hl.rects.map((rect, idx) => (
              <div
                key={`${hl.id}-${idx}`}
                title={`Surlignage : « ${hl.text} » (Cliquer pour supprimer)`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveHighlight(hl.id);
                }}
                style={{
                  left: `${rect.xRatio * 100}%`,
                  top: `${rect.yRatio * 100}%`,
                  width: `${rect.widthRatio * 100}%`,
                  height: `${rect.heightRatio * 100}%`,
                }}
                className={`pointer-events-auto absolute cursor-pointer transition-opacity hover:opacity-75 mix-blend-multiply dark:mix-blend-screen ${getHighlightBgClass(
                  hl.color
                )}`}
              />
            ))
          )}
        </div>

        {/* 2. Transparent Vector TextLayer aligned with PDF.js Canvas */}
        <div
          ref={layerRef}
          data-testid={`reader-text-layer-${pageNumber}`}
          onMouseUp={(e) =>
            handleTextSelectionEnd(pageNumber, layerRef.current, e)
          }
          className="absolute inset-0 z-20 select-text overflow-hidden cursor-text"
        >
          {spans.map((span, idx) => {
            const isSearchMatch =
              normalizedSearchNeedle.length >= 2 &&
              span.str
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .includes(normalizedSearchNeedle);

            return (
              <span
                key={`${pageNumber}-span-${idx}`}
                style={{
                  left: `${span.xRatio * 100}%`,
                  top: `${span.yRatio * 100}%`,
                  width: `${span.widthRatio * 100}%`,
                  height: `${span.heightRatio * 100}%`,
                  fontSize: `${Math.max(9, span.fontSizeRatio * 680 * effectiveScale)}px`,
                  lineHeight: 1,
                }}
                className={`absolute whitespace-pre text-transparent selection:bg-[#9A3412]/30 selection:text-transparent ${
                  isSearchMatch
                    ? 'bg-amber-400/45 ring-1 ring-[#9A3412]'
                    : ''
                }`}
              >
                {span.str}
              </span>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="relative flex-1 w-full h-full flex items-center justify-center overflow-auto py-8 px-4 sm:px-12">
      {/* Floating Contextual Selection Popover (Ink Highlighting, Citation Copy, Quoted Note) */}
      {activeSelection && (
        <div
          role="dialog"
          aria-label="Outils de surlignage et citation du texte sélectionné"
          data-testid="text-selection-popover"
          style={{
            left: `${activeSelection.popoverX}px`,
            top: `${activeSelection.popoverY}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed -translate-x-1/2 -translate-y-full z-50 bg-[#1C1917] text-[#FBF9F5] border border-stone-700 shadow-2xl p-2 flex flex-col gap-2 min-w-[270px]"
        >
          <div className="flex items-center justify-between gap-2 px-1">
            {/* 3 Curated Ink Highlight Colors */}
            <div className="flex items-center gap-1.5">
              <Highlighter className="w-3.5 h-3.5 text-stone-400 mr-0.5" />
              <button
                type="button"
                onClick={() => handleApplyHighlight('amber')}
                aria-label="Surligner en Ambre"
                className="px-2 py-1 text-[11px] font-medium bg-amber-400/25 text-amber-200 border border-amber-400/50 hover:bg-amber-400/40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Ambre
              </button>
              <button
                type="button"
                onClick={() => handleApplyHighlight('terracotta')}
                aria-label="Surligner en Terracotta"
                className="px-2 py-1 text-[11px] font-medium bg-[#9A3412]/40 text-orange-200 border border-[#9A3412] hover:bg-[#9A3412]/70 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Terracotta
              </button>
              <button
                type="button"
                onClick={() => handleApplyHighlight('lapis')}
                aria-label="Surligner en Lapis"
                className="px-2 py-1 text-[11px] font-medium bg-blue-600/35 text-blue-200 border border-blue-500/60 hover:bg-blue-600/55 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Lapis
              </button>
            </div>

            <span aria-hidden="true" className="text-stone-600">
              |
            </span>

            {/* Copy Citation & Add Quoted Note */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleCopyFormattedCitation()}
                aria-label="Copier la citation avec référence"
                className="p-1.5 text-xs hover:bg-stone-800 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                {copiedFeedback ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[11px]">
                  {copiedFeedback ? 'Copié' : 'Citer'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsNotePromptOpen((prev) => !prev)}
                aria-label="Annoter ce passage"
                className="p-1.5 text-xs hover:bg-stone-800 transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span className="text-[11px]">Annoter</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  window.getSelection()?.removeAllRanges();
                  setActiveSelection(null);
                }}
                aria-label="Fermer le menu de sélection"
                className="p-1 text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isNotePromptOpen && (
            <form
              onSubmit={handleSaveQuotedNote}
              className="border-t border-stone-700 pt-2 flex gap-1.5"
            >
              <input
                type="text"
                value={quoteNoteInput}
                onChange={(e) => setQuoteNoteInput(e.target.value)}
                placeholder="Votre réflexion sur ce passage…"
                autoFocus
                className="flex-1 px-2.5 py-1 text-xs bg-stone-900 border border-stone-700 text-stone-100 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                className="px-2.5 py-1 text-xs font-semibold bg-[#9A3412] text-white hover:bg-[#7C2D12] cursor-pointer whitespace-nowrap shrink-0"
              >
                Enregistrer
              </button>
            </form>
          )}
        </div>
      )}

      {/* Left Margin Page-Turn Zone */}
      <button
        type="button"
        onClick={onPreviousPage}
        disabled={!canGoPrevious}
        aria-label="Page précédente"
        className={`fixed left-2 sm:left-5 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full transition-opacity duration-150 cursor-pointer ${
          canGoPrevious
            ? 'opacity-40 hover:opacity-100 focus-visible:opacity-100 text-current bg-black/5 dark:bg-white/10'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      {/* Central Book Page / Spread Surface */}
      <div
        onClick={handlePageContainerClick}
        role="region"
        aria-label={`Contenu du livre — Page ${visiblePages.join(' et ')}`}
        className="relative flex items-center justify-center my-auto"
      >
        {renderError ? (
          <div
            role="alert"
            className="p-8 border border-red-800/40 bg-red-950/10 text-center max-w-md"
          >
            <p className="font-serif text-lg font-semibold">{renderError}</p>
          </div>
        ) : (
          <div
            className={`flex items-center justify-center transition-shadow duration-200 ${
              viewMode === 'double' && rightPageNumber !== null
                ? 'shadow-2xl border border-stone-300/60 dark:border-stone-800'
                : 'shadow-xl border border-stone-300/60 dark:border-stone-800'
            }`}
          >
            {/* Left / Single Page Canvas + Aligned Vector TextLayer */}
            <div className="relative bg-white overflow-hidden">
              <canvas
                ref={leftCanvasRef}
                data-testid="reader-canvas-primary"
                data-page-number={leftPageNumber}
                data-auto-crop={String(autoCropMargins)}
                className={`block transition-all duration-150 ${filterClass}`}
              />
              {renderPageOverlays(leftPageNumber, leftTextSpans, leftLayerRef)}
              {viewMode === 'double' && rightPageNumber !== null && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/15 via-black/5 to-transparent z-30"
                />
              )}
            </div>

            {/* Right Page Canvas + Aligned Vector TextLayer (when in Double-Page Mode) */}
            {viewMode === 'double' && rightPageNumber !== null && (
              <div className="relative bg-white overflow-hidden border-l border-stone-300/70">
                <canvas
                  ref={rightCanvasRef}
                  data-testid="reader-canvas-secondary"
                  data-page-number={rightPageNumber}
                  data-auto-crop={String(autoCropMargins)}
                  className={`block transition-all duration-150 ${filterClass}`}
                />
                {renderPageOverlays(
                  rightPageNumber,
                  rightTextSpans,
                  rightLayerRef
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/15 via-black/5 to-transparent z-30"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Margin Page-Turn Zone */}
      <button
        type="button"
        onClick={onNextPage}
        disabled={!canGoNext}
        aria-label="Page suivante"
        className={`fixed right-2 sm:right-5 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full transition-opacity duration-150 cursor-pointer ${
          canGoNext
            ? 'opacity-40 hover:opacity-100 focus-visible:opacity-100 text-current bg-black/5 dark:bg-white/10'
            : 'opacity-0 pointer-events-none'
        }`}
      >
        <ChevronRight className="w-6 h-6" />
      </button>
    </div>
  );
};
