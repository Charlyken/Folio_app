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
import { Book, BookWithProgress } from '../domain/entities/Book';
import { createInitialReadingSession } from '../domain/entities/ReadingSession';
import { IBookRepository } from '../domain/repositories/IBookRepository';
import { IPdfEngine } from '../domain/services/IPdfEngine';
import {
  ALLOWED_PDF_MIME_TYPE,
  buildBookSearchIndex,
  computeSha256Hex,
  MAX_PDF_FILE_SIZE_BYTES,
  PDF_CHUNK_SIZE_BYTES,
} from '../domain/services/ReadingRules';
import {
  buildSyntheticPdfBlob,
  CURATED_SEED_BOOKS,
} from '../infrastructure/pdf/SamplePdfGenerator';

const SEED_COMPLETED_STORAGE_KEY = 'folio_curated_library_seeded_v4';

export type LibraryFilter = 'all' | 'in_progress' | 'completed' | 'bookmarked';

export interface DeduplicationNotice {
  readonly book: Book;
  readonly message: string;
}

export interface UseLibraryResult {
  readonly libraryState: AsyncState<readonly BookWithProgress[]>;
  readonly uploadState: AsyncState<Book>;
  readonly deduplicationNotice: DeduplicationNotice | null;
  readonly activeFilter: LibraryFilter;
  readonly searchQuery: string;
  readonly filteredBooks: readonly BookWithProgress[];
  readonly setActiveFilter: (filter: LibraryFilter) => void;
  readonly setSearchQuery: (query: string) => void;
  readonly uploadPdfFile: (file: File) => Promise<Book | null>;
  readonly deleteBook: (bookId: string) => Promise<void>;
  readonly restoreSampleBooks: () => Promise<void>;
  readonly dismissUploadError: () => void;
  readonly dismissDeduplicationNotice: () => void;
  readonly refreshLibrary: () => Promise<void>;
}

export function useLibrary(
  repository: IBookRepository,
  pdfEngine: IPdfEngine
): UseLibraryResult {
  const [libraryState, setLibraryState] = useState<
    AsyncState<readonly BookWithProgress[]>
  >({
    status: 'loading',
    message: 'Chargement de votre bibliothèque éditoriale…',
  });

  const [uploadState, setUploadState] = useState<AsyncState<Book>>({
    status: 'idle',
  });

  const [deduplicationNotice, setDeduplicationNotice] =
    useState<DeduplicationNotice | null>(null);

  const [activeFilter, setActiveFilter] = useState<LibraryFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const isSeedingRef = useRef<boolean>(false);

  const seedInitialBooksIfNeeded = useCallback(async () => {
    if (isSeedingRef.current) return;
    isSeedingRef.current = true;

    try {
      const existing = await repository.getAllBooksMetadata();
      const alreadySeeded =
        window.localStorage.getItem(SEED_COMPLETED_STORAGE_KEY) === 'true';

      if (existing.length === 0 && !alreadySeeded) {
        const now = Date.now();
        for (let i = 0; i < CURATED_SEED_BOOKS.length; i++) {
          const spec = CURATED_SEED_BOOKS[i];
          const pdfBlob = buildSyntheticPdfBlob(spec);
          const buffer = await pdfBlob.arrayBuffer();
          const contentHash = await computeSha256Hex(buffer);

          const extracted = await pdfEngine.extractCoverAndMetadata(
            pdfBlob,
            spec.title
          );

          const chunkCount = Math.max(
            1,
            Math.ceil(pdfBlob.size / PDF_CHUNK_SIZE_BYTES)
          );

          const book: Book = {
            id: spec.id,
            title: spec.title,
            author: spec.author,
            totalPages: extracted.totalPages,
            coverDataUrl: extracted.coverDataUrl,
            fileSizeBytes: pdfBlob.size,
            contentHash,
            chunkCount,
            addedAt: now - (CURATED_SEED_BOOKS.length - i) * 3600_000,
            lastReadAt: i === 0 ? now - 600_000 : null,
          };

          const baseSession = createInitialReadingSession(spec.id);
          const initialSession = {
            ...baseSession,
            currentPage: spec.initialPage,
            bookmarks: spec.initialBookmarks,
          };

          await repository.saveBook(book, pdfBlob, initialSession);

          const searchIndex = buildBookSearchIndex(spec.id, extracted.pagesText);
          await repository.saveBookSearchIndex(searchIndex);
        }
        window.localStorage.setItem(SEED_COMPLETED_STORAGE_KEY, 'true');
      }
    } catch {
      // Non-fatal if seeding fails
    } finally {
      isSeedingRef.current = false;
    }
  }, [repository, pdfEngine]);

  const refreshLibrary = useCallback(async () => {
    try {
      await seedInitialBooksIfNeeded();
      const books = await repository.getAllBooksMetadata();
      setLibraryState({ status: 'success', data: books });
    } catch (err: unknown) {
      const appErr = normalizeToAppError(err);
      setLibraryState({ status: 'error', error: appErr });
    }
  }, [repository, seedInitialBooksIfNeeded]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const uploadPdfFile = useCallback(
    async (file: File): Promise<Book | null> => {
      setDeduplicationNotice(null);

      const isPdfMime = file.type === ALLOWED_PDF_MIME_TYPE;
      const isPdfExt = file.name.toLowerCase().endsWith('.pdf');
      if (!isPdfMime && !isPdfExt) {
        setUploadState({
          status: 'error',
          error: createAppError(
            'INVALID_MIME_TYPE',
            'Format de fichier non pris en charge',
            `Le fichier « ${file.name} » n’est pas un document PDF valide. Veuillez sélectionner un fichier .pdf.`
          ),
        });
        return null;
      }

      if (file.size > MAX_PDF_FILE_SIZE_BYTES) {
        setUploadState({
          status: 'error',
          error: createAppError(
            'FILE_TOO_LARGE',
            'Fichier PDF trop volumineux',
            `La taille du fichier dépasse la limite autorisée de 150 Mo.`
          ),
        });
        return null;
      }

      if (file.size === 0) {
        setUploadState({
          status: 'error',
          error: createAppError(
            'CORRUPTED_PDF',
            'Fichier PDF vide',
            `Le fichier « ${file.name} » est vide (0 octet).`
          ),
        });
        return null;
      }

      setUploadState({
        status: 'loading',
        message: `Extraction de la couverture et indexation plein texte de « ${file.name} »…`,
      });

      try {
        const buffer = await file.arrayBuffer();
        const contentHash = await computeSha256Hex(buffer);

        const existingBook = await repository.findBookByContentHash(contentHash);
        if (existingBook) {
          const existingSession = await repository.getReadingSession(
            existingBook.id
          );
          await repository.updateReadingProgress(existingSession);
          const updatedBooks = await repository.getAllBooksMetadata();
          setLibraryState({ status: 'success', data: updatedBooks });
          setUploadState({ status: 'success', data: existingBook });
          setDeduplicationNotice({
            book: existingBook,
            message: `Empreinte SHA-256 identique détectée (${contentHash.slice(0, 12)}…). L’ouvrage « ${existingBook.title} » et vos signets existants ont été restaurés sans doublon.`,
          });
          return existingBook;
        }

        const extracted = await pdfEngine.extractCoverAndMetadata(
          file,
          file.name
        );

        const chunkCount = Math.max(
          1,
          Math.ceil(file.size / PDF_CHUNK_SIZE_BYTES)
        );

        const newBookId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const newBook: Book = {
          id: newBookId,
          title: extracted.title,
          author: extracted.author,
          totalPages: extracted.totalPages,
          coverDataUrl: extracted.coverDataUrl,
          fileSizeBytes: file.size,
          contentHash,
          chunkCount,
          addedAt: Date.now(),
          lastReadAt: Date.now(),
        };

        await repository.saveBook(newBook, file);

        // Persist the inverted full-text search index inside `books_search_index`
        const searchIndex = buildBookSearchIndex(newBookId, extracted.pagesText);
        await repository.saveBookSearchIndex(searchIndex);

        const updatedBooks = await repository.getAllBooksMetadata();
        setLibraryState({ status: 'success', data: updatedBooks });
        setUploadState({ status: 'success', data: newBook });
        return newBook;
      } catch (err: unknown) {
        const appErr = normalizeToAppError(err);
        setUploadState({ status: 'error', error: appErr });
        return null;
      }
    },
    [pdfEngine, repository]
  );

  const deleteBook = useCallback(
    async (bookId: string): Promise<void> => {
      try {
        await repository.deleteBook(bookId);
        const updatedBooks = await repository.getAllBooksMetadata();
        setLibraryState({ status: 'success', data: updatedBooks });
      } catch (err: unknown) {
        const appErr = normalizeToAppError(err);
        setLibraryState({ status: 'error', error: appErr });
      }
    },
    [repository]
  );

  const restoreSampleBooks = useCallback(async (): Promise<void> => {
    window.localStorage.removeItem(SEED_COMPLETED_STORAGE_KEY);
    setLibraryState({
      status: 'loading',
      message: 'Restauration des ouvrages de la collection…',
    });
    await refreshLibrary();
  }, [refreshLibrary]);

  const dismissUploadError = useCallback(() => {
    setUploadState({ status: 'idle' });
  }, []);

  const dismissDeduplicationNotice = useCallback(() => {
    setDeduplicationNotice(null);
  }, []);

  const allBooks = libraryState.status === 'success' ? libraryState.data : [];
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredBooks = allBooks.filter((book) => {
    if (activeFilter === 'in_progress') {
      if (book.currentPage <= 1 || book.progressPercentage >= 100) return false;
    } else if (activeFilter === 'completed') {
      if (book.progressPercentage < 100) return false;
    } else if (activeFilter === 'bookmarked') {
      if (book.bookmarksCount === 0) return false;
    }

    if (normalizedQuery.length > 0) {
      const matchTitle = book.title.toLowerCase().includes(normalizedQuery);
      const matchAuthor = book.author.toLowerCase().includes(normalizedQuery);
      return matchTitle || matchAuthor;
    }
    return true;
  });

  return {
    libraryState,
    uploadState,
    deduplicationNotice,
    activeFilter,
    searchQuery,
    filteredBooks,
    setActiveFilter,
    setSearchQuery,
    uploadPdfFile,
    deleteBook,
    restoreSampleBooks,
    dismissUploadError,
    dismissDeduplicationNotice,
    refreshLibrary,
  };
}

function normalizeToAppError(err: unknown): AppError {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'title' in err &&
    'message' in err
  ) {
    return err as AppError;
  }
  const message =
    err instanceof Error
      ? err.message
      : 'Une erreur inattendue est survenue lors du traitement du document.';
  return createAppError('UNKNOWN_ERROR', 'Erreur d’opération', message);
}
