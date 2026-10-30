/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Book, BookWithProgress } from '../../domain/entities/Book';
import {
  createInitialReadingSession,
  ReadingSession,
} from '../../domain/entities/ReadingSession';
import { createAppError } from '../../domain/entities/AsyncState';
import { IBookRepository } from '../../domain/repositories/IBookRepository';
import { calculateProgressPercentage } from '../../domain/services/ReadingRules';

const DB_NAME = 'folio_kindle_reader_db';
const DB_VERSION = 1;

const STORE_BOOKS_METADATA = 'books_metadata';
const STORE_BOOKS_BLOBS = 'books_blobs';
const STORE_READING_SESSIONS = 'reading_sessions';

interface StoredBlobRecord {
  readonly bookId: string;
  readonly pdfBlob: Blob;
}

export class IndexedDbBookRepository implements IBookRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_BOOKS_METADATA)) {
          const metaStore = db.createObjectStore(STORE_BOOKS_METADATA, {
            keyPath: 'id',
          });
          metaStore.createIndex('addedAt', 'addedAt', { unique: false });
          metaStore.createIndex('lastReadAt', 'lastReadAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_BOOKS_BLOBS)) {
          db.createObjectStore(STORE_BOOKS_BLOBS, {
            keyPath: 'bookId',
          });
        }

        if (!db.objectStoreNames.contains(STORE_READING_SESSIONS)) {
          db.createObjectStore(STORE_READING_SESSIONS, {
            keyPath: 'bookId',
          });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(
          createAppError(
            'UNKNOWN_ERROR',
            'Erreur de base de données locale',
            request.error?.message ?? 'Impossible d’ouvrir IndexedDB.'
          )
        );
      };
    });

    return this.dbPromise;
  }

  public async saveBook(
    book: Book,
    pdfBlob: Blob,
    initialSession?: ReadingSession
  ): Promise<void> {
    const db = await this.openDatabase();
    const session = initialSession ?? createInitialReadingSession(book.id);

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_BOOKS_METADATA, STORE_BOOKS_BLOBS, STORE_READING_SESSIONS],
        'readwrite'
      );

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        const isQuota = tx.error?.name === 'QuotaExceededError';
        reject(
          createAppError(
            isQuota ? 'STORAGE_QUOTA_EXCEEDED' : 'UNKNOWN_ERROR',
            isQuota ? 'Espace de stockage saturé' : 'Échec de la sauvegarde',
            isQuota
              ? 'La mémoire locale du navigateur est pleine. Supprimez un livre existant pour libérer de l’espace.'
              : tx.error?.message ?? 'Impossible d’enregistrer le livre dans IndexedDB.'
          )
        );
      };

      const metaStore = tx.objectStore(STORE_BOOKS_METADATA);
      const blobStore = tx.objectStore(STORE_BOOKS_BLOBS);
      const sessionStore = tx.objectStore(STORE_READING_SESSIONS);

      metaStore.put(book);
      const blobRecord: StoredBlobRecord = { bookId: book.id, pdfBlob };
      blobStore.put(blobRecord);
      sessionStore.put(session);
    });
  }

  public async getBookBlob(bookId: string): Promise<Blob | null> {
    const db = await this.openDatabase();
    return new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction([STORE_BOOKS_BLOBS], 'readonly');
      const store = tx.objectStore(STORE_BOOKS_BLOBS);
      const request = store.get(bookId);

      request.onsuccess = () => {
        const result = request.result as StoredBlobRecord | undefined;
        resolve(result ? result.pdfBlob : null);
      };

      request.onerror = () => {
        reject(
          createAppError(
            'BOOK_NOT_FOUND',
            'Fichier PDF introuvable',
            request.error?.message ?? 'Impossible de charger le fichier binaire du livre.'
          )
        );
      };
    });
  }

  public async getBookMetadata(bookId: string): Promise<Book | null> {
    const db = await this.openDatabase();
    return new Promise<Book | null>((resolve, reject) => {
      const tx = db.transaction([STORE_BOOKS_METADATA], 'readonly');
      const store = tx.objectStore(STORE_BOOKS_METADATA);
      const request = store.get(bookId);

      request.onsuccess = () => {
        const result = request.result as Book | undefined;
        resolve(result ?? null);
      };

      request.onerror = () => {
        reject(
          createAppError(
            'BOOK_NOT_FOUND',
            'Métadonnées introuvables',
            request.error?.message ?? 'Impossible de lire les métadonnées du livre.'
          )
        );
      };
    });
  }

  public async getAllBooksMetadata(): Promise<BookWithProgress[]> {
    const db = await this.openDatabase();
    return new Promise<BookWithProgress[]>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_BOOKS_METADATA, STORE_READING_SESSIONS],
        'readonly'
      );
      const metaStore = tx.objectStore(STORE_BOOKS_METADATA);
      const sessionStore = tx.objectStore(STORE_READING_SESSIONS);

      const booksReq = metaStore.getAll();
      const sessionsReq = sessionStore.getAll();

      tx.oncomplete = () => {
        const books = (booksReq.result as Book[]) ?? [];
        const sessions = (sessionsReq.result as ReadingSession[]) ?? [];
        const sessionMap = new Map<string, ReadingSession>();
        for (const s of sessions) {
          sessionMap.set(s.bookId, s);
        }

        const combined: BookWithProgress[] = books.map((book) => {
          const session = sessionMap.get(book.id);
          const currentPage = session ? session.currentPage : 1;
          const progressPercentage = calculateProgressPercentage(
            currentPage,
            book.totalPages
          );
          const bookmarksCount = session ? session.bookmarks.length : 0;
          return {
            ...book,
            currentPage,
            progressPercentage,
            bookmarksCount,
          };
        });

        // Sort by most recently read first, then by addedAt descending
        combined.sort((a, b) => {
          const aTime = a.lastReadAt ?? a.addedAt;
          const bTime = b.lastReadAt ?? b.addedAt;
          return bTime - aTime;
        });

        resolve(combined);
      };

      tx.onerror = () => {
        reject(
          createAppError(
            'UNKNOWN_ERROR',
            'Erreur de chargement de la bibliothèque',
            tx.error?.message ?? 'Impossible de récupérer la liste des ouvrages.'
          )
        );
      };
    });
  }

  public async getReadingSession(bookId: string): Promise<ReadingSession> {
    const db = await this.openDatabase();
    return new Promise<ReadingSession>((resolve, reject) => {
      const tx = db.transaction([STORE_READING_SESSIONS], 'readonly');
      const store = tx.objectStore(STORE_READING_SESSIONS);
      const request = store.get(bookId);

      request.onsuccess = () => {
        const existing = request.result as ReadingSession | undefined;
        resolve(existing ?? createInitialReadingSession(bookId));
      };

      request.onerror = () => {
        reject(
          createAppError(
            'UNKNOWN_ERROR',
            'Erreur de session de lecture',
            request.error?.message ?? 'Impossible de récupérer la progression.'
          )
        );
      };
    });
  }

  public async updateReadingProgress(session: ReadingSession): Promise<void> {
    const db = await this.openDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_BOOKS_METADATA, STORE_READING_SESSIONS],
        'readwrite'
      );

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        reject(
          createAppError(
            'UNKNOWN_ERROR',
            'Erreur de sauvegarde de progression',
            tx.error?.message ?? 'Impossible de sauvegarder la page courante.'
          )
        );
      };

      const sessionStore = tx.objectStore(STORE_READING_SESSIONS);
      sessionStore.put({
        ...session,
        updatedAt: Date.now(),
      });

      const metaStore = tx.objectStore(STORE_BOOKS_METADATA);
      const getBookReq = metaStore.get(session.bookId);
      getBookReq.onsuccess = () => {
        const book = getBookReq.result as Book | undefined;
        if (book) {
          const updatedBook: Book = {
            ...book,
            lastReadAt: Date.now(),
          };
          metaStore.put(updatedBook);
        }
      };
    });
  }

  public async deleteBook(bookId: string): Promise<void> {
    const db = await this.openDatabase();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [STORE_BOOKS_METADATA, STORE_BOOKS_BLOBS, STORE_READING_SESSIONS],
        'readwrite'
      );

      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        reject(
          createAppError(
            'UNKNOWN_ERROR',
            'Erreur lors de la suppression',
            tx.error?.message ?? 'Impossible de supprimer cet ouvrage.'
          )
        );
      };

      tx.objectStore(STORE_BOOKS_METADATA).delete(bookId);
      tx.objectStore(STORE_BOOKS_BLOBS).delete(bookId);
      tx.objectStore(STORE_READING_SESSIONS).delete(bookId);
    });
  }
}
