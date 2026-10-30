/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  ReaderTheme,
  ReaderViewMode,
} from '../../../domain/entities/ReadingSession';
import { IPdfDocumentHandle } from '../../../domain/services/IPdfEngine';

export interface ReaderCanvasProps {
  readonly documentHandle: IPdfDocumentHandle;
  readonly visiblePages: readonly number[];
  readonly zoomLevel: number;
  readonly theme: ReaderTheme;
  readonly viewMode: ReaderViewMode;
  readonly autoCropMargins: boolean;
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly onPreviousPage: () => void;
  readonly onNextPage: () => void;
  readonly onCenterTap: () => void;
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

export const ReaderCanvas: React.FC<ReaderCanvasProps> = ({
  documentHandle,
  visiblePages,
  zoomLevel,
  theme,
  viewMode,
  autoCropMargins,
  canGoPrevious,
  canGoNext,
  onPreviousPage,
  onNextPage,
  onCenterTap,
}) => {
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const leftPageNumber = visiblePages[0] ?? 1;
  const rightPageNumber =
    viewMode === 'double' && visiblePages.length > 1 ? visiblePages[1] : null;

  const baseScale =
    viewMode === 'double' ? BASE_PAGE_SCALE_DOUBLE : BASE_PAGE_SCALE_SINGLE;
  const effectiveScale = baseScale * zoomLevel;

  // Render Left (or Single) Page
  useEffect(() => {
    const canvas = leftCanvasRef.current;
    if (!canvas) return;

    let isCancelled = false;
    setRenderError(null);

    void documentHandle
      .renderPageToCanvas({
        pageNumber: leftPageNumber,
        canvas,
        scale: effectiveScale,
        autoCropMargins,
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

  // Render Right Page in Double-Page Book Spread Mode
  useEffect(() => {
    const canvas = rightCanvasRef.current;
    if (!canvas) return;

    if (rightPageNumber === null) {
      documentHandle.cancelActiveRender(canvas);
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    let isCancelled = false;

    void documentHandle
      .renderPageToCanvas({
        pageNumber: rightPageNumber,
        canvas,
        scale: effectiveScale,
        autoCropMargins,
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

  const filterClass = getCanvasThemeFilterClass(theme);

  return (
    <div className="relative flex-1 w-full h-full flex items-center justify-center overflow-auto py-8 px-4 sm:px-12 select-none">
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
        onClick={onCenterTap}
        role="region"
        aria-label={`Contenu du livre — Page ${visiblePages.join(' et ')}`}
        className="relative flex items-center justify-center cursor-pointer my-auto"
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
            {/* Left / Single Page Canvas */}
            <div className="relative bg-white overflow-hidden">
              <canvas
                ref={leftCanvasRef}
                data-testid="reader-canvas-primary"
                data-page-number={leftPageNumber}
                data-auto-crop={String(autoCropMargins)}
                className={`block transition-all duration-150 ${filterClass}`}
              />
              {viewMode === 'double' && rightPageNumber !== null && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/15 via-black/5 to-transparent"
                />
              )}
            </div>

            {/* Right Page Canvas (when in Double-Page Open Book Mode) */}
            {viewMode === 'double' && rightPageNumber !== null && (
              <div className="relative bg-white overflow-hidden border-l border-stone-300/70">
                <canvas
                  ref={rightCanvasRef}
                  data-testid="reader-canvas-secondary"
                  data-page-number={rightPageNumber}
                  data-auto-crop={String(autoCropMargins)}
                  className={`block transition-all duration-150 ${filterClass}`}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/15 via-black/5 to-transparent"
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
