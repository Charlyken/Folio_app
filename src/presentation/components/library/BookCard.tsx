/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import { BookWithProgress } from '../../../domain/entities/Book';
import { formatFileSize } from '../../../domain/services/ReadingRules';

export interface BookCardProps {
  readonly book: BookWithProgress;
  readonly onOpenBook: (bookId: string) => void;
  readonly onDeleteBook: (bookId: string) => Promise<void>;
}

export const BookCard: React.FC<BookCardProps> = ({
  book,
  onOpenBook,
  onDeleteBook,
}) => {
  const [imageError, setImageError] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

  return (
    <article className="group flex flex-col justify-between border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 sm:p-5 transition-colors hover:border-stone-400 dark:hover:border-stone-600">
      <div>
        {/* Book Cover Container with 3:4 Portrait Aspect Ratio */}
        <div className="relative aspect-[3/4] w-full bg-[#EBE6DF] dark:bg-stone-800 mb-4 overflow-hidden border border-stone-200 dark:border-stone-700/70">
          {!imageError && book.coverDataUrl ? (
            <img
              src={book.coverDataUrl}
              alt={`Couverture de ${book.title}`}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="w-full h-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.015]"
            />
          ) : (
            <div className="w-full h-full flex flex-col justify-between p-5 bg-gradient-to-b from-[#F7F4EE] to-[#EBE6DF] dark:from-stone-800 dark:to-stone-900 text-stone-800 dark:text-stone-200">
              <span className="text-[11px] uppercase tracking-widest text-stone-500 dark:text-stone-400 font-mono">
                ÉDITION FOLIO
              </span>
              <div>
                <p className="font-serif text-lg font-semibold leading-snug line-clamp-3">
                  {book.title}
                </p>
                <p className="text-xs text-stone-600 dark:text-stone-400 mt-1">
                  {book.author}
                </p>
              </div>
              <BookOpen className="w-5 h-5 text-stone-500 stroke-[1.5]" />
            </div>
          )}

          {/* Subtle book spine crease effect on the left edge */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/15 via-black/5 to-transparent"
          />
        </div>

        {/* Progress Bar directly underneath cover as requested */}
        <div className="mb-3">
          <div
            className="h-1 w-full bg-stone-200 dark:bg-stone-800 overflow-hidden"
            role="progressbar"
            aria-valuenow={book.progressPercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progression de lecture pour ${book.title} : ${book.progressPercentage}%`}
          >
            <div
              className="h-full bg-[#9A3412] dark:bg-amber-500 transition-transform duration-200 origin-left"
              style={{
                transform: `scaleX(${Math.max(0.02, book.progressPercentage / 100)})`,
              }}
            />
          </div>

          {/* Unboxed Metadata with · separators & tabular numerals (Zero-Pill Discipline) */}
          <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 mt-2 font-mono tabular-nums">
            <span>
              Page {book.currentPage} / {book.totalPages}
            </span>
            <span aria-hidden="true">·</span>
            <span>{book.progressPercentage}% lu</span>
          </div>
        </div>

        {/* Title & Author */}
        <h3 className="font-serif text-xl font-semibold text-stone-900 dark:text-stone-100 leading-snug line-clamp-2">
          {book.title}
        </h3>
        <div className="flex items-center flex-wrap gap-1.5 text-xs text-stone-600 dark:text-stone-400 mt-1">
          <span className="truncate max-w-[160px]">{book.author}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {formatFileSize(book.fileSizeBytes)}
          </span>
          {book.bookmarksCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {book.bookmarksCount} signet{book.bookmarksCount > 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions Row */}
      <div className="mt-5 pt-3 border-t border-stone-200/80 dark:border-stone-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenBook(book.id)}
          aria-label={`Ouvrir ${book.title}`}
          className="flex-1 py-2 px-4 text-xs font-semibold tracking-wide text-stone-900 dark:text-stone-100 bg-[#F7F4EE] hover:bg-[#1C1917] hover:text-white dark:bg-stone-800 dark:hover:bg-stone-100 dark:hover:text-stone-900 transition-colors text-center whitespace-nowrap shrink-0 cursor-pointer"
        >
          {book.currentPage > 1 ? 'Reprendre la lecture' : 'Ouvrir l’ouvrage'}
        </button>

        {confirmDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void onDeleteBook(book.id)}
              aria-label={`Confirmer la suppression de ${book.title}`}
              className="px-2.5 py-2 text-xs font-semibold text-white bg-red-800 hover:bg-red-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Supprimer
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              aria-label={`Annuler la suppression de ${book.title}`}
              className="px-2 py-2 text-xs text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Annuler
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Supprimer ${book.title}`}
            className="p-2 text-stone-400 hover:text-red-700 dark:hover:text-red-400 transition-colors shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </article>
  );
};
