/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useRef, useState } from 'react';
import { AlertCircle, FileUp, Loader2, X } from 'lucide-react';
import { AsyncState } from '../../../domain/entities/AsyncState';
import { Book } from '../../../domain/entities/Book';

export interface PdfDropzoneProps {
  readonly uploadState: AsyncState<Book>;
  readonly onUploadFile: (file: File) => Promise<Book | null>;
  readonly onDismissError: () => void;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export const PdfDropzone: React.FC<PdfDropzoneProps> = ({
  uploadState,
  onUploadFile,
  onDismissError,
  isOpen,
  onClose,
}) => {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const droppedFile = event.dataTransfer.files?.[0];
      if (droppedFile) {
        const result = await onUploadFile(droppedFile);
        if (result) {
          onClose();
        }
      }
    },
    [onUploadFile, onClose]
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      if (selectedFile) {
        const result = await onUploadFile(selectedFile);
        event.target.value = '';
        if (result) {
          onClose();
        }
      }
    },
    [onUploadFile, onClose]
  );

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (!isOpen && uploadState.status !== 'error' && uploadState.status !== 'loading') {
    return null;
  }

  return (
    <section
      aria-label="Importation d'ouvrage PDF"
      className="mb-10 border border-stone-300/80 dark:border-stone-800 bg-[#F7F4EE] dark:bg-stone-900/90 p-6 sm:p-8 transition-colors"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-serif font-semibold text-stone-900 dark:text-stone-100">
            Acquisition d’un nouvel ouvrage numérique
          </h2>
          <p className="text-sm text-stone-600 dark:text-stone-400 mt-1">
            Glissez-déposez un manuscrit ou livre au format PDF. La couverture haute résolution et la table des matières sont extraites localement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onDismissError();
            onClose();
          }}
          aria-label="Fermer le panneau d'importation"
          className="p-2 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 transition-colors shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {uploadState.status === 'error' && (
        <div
          role="alert"
          className="mb-5 p-4 border border-red-800/30 bg-red-950/5 dark:bg-red-950/30 text-red-900 dark:text-red-200 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">{uploadState.error.title}</p>
              <p className="text-xs text-red-800/90 dark:text-red-300 mt-0.5">
                {uploadState.error.message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismissError}
            className="text-xs font-medium underline hover:no-underline whitespace-nowrap shrink-0"
          >
            Effacer
          </button>
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border border-dashed p-8 sm:p-10 text-center transition-colors ${
          isDragging
            ? 'border-[#9A3412] bg-[#9A3412]/5 dark:border-amber-500 dark:bg-amber-500/10'
            : 'border-stone-400/70 dark:border-stone-700 bg-[#FBF9F5] dark:bg-stone-950/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          className="sr-only"
          aria-label="Sélectionner un fichier PDF depuis votre appareil"
        />

        {uploadState.status === 'loading' ? (
          <div className="flex flex-col items-center justify-center py-4">
            <Loader2 className="w-8 h-8 text-[#9A3412] dark:text-amber-500 animate-spin mb-3" />
            <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
              {uploadState.message ?? 'Traitement du document PDF en cours…'}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              Rastérisation de la miniature de couverture et indexation dans IndexedDB
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center">
            <FileUp className="w-8 h-8 text-stone-600 dark:text-stone-400 mb-3 stroke-[1.5]" />
            <p className="text-base font-medium text-stone-900 dark:text-stone-100">
              Déposez votre fichier PDF ici
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 mb-5">
              Format supporté : PDF standard jusqu’à 150 Mo · Stockage 100 % privé hors-ligne
            </p>
            <button
              type="button"
              onClick={triggerFilePicker}
              className="px-5 py-2.5 text-xs font-semibold tracking-wide text-white bg-[#1C1917] hover:bg-[#9A3412] dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Parcourir les fichiers PDF
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
