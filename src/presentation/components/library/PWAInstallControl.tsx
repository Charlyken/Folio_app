/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../../../application/usePWAInstall';

export const PWAInstallControl: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isOnline, install } =
    usePWAInstall();
  const [showModal, setShowModal] = useState<boolean>(false);

  return (
    <>
      {/* Offline Banner when disconnected */}
      {!isOnline && (
        <div
          role="status"
          className="px-3 py-1.5 text-xs font-medium bg-amber-900/15 dark:bg-amber-500/15 border border-amber-800/30 text-amber-900 dark:text-amber-300 flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>Mode Hors-Ligne Actif (Cache PWA & IndexedDB)</span>
        </div>
      )}

      {/* Install PWA Button in Workspace Toolbar */}
      {!isInstalled && (
        <button
          type="button"
          onClick={() => {
            if (isInstallable) {
              void install();
            } else {
              setShowModal(true);
            }
          }}
          aria-label="Installer l’application PWA hors-ligne"
          className="px-3 py-2 text-xs font-medium border border-stone-300 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 hover:border-[#9A3412] dark:hover:border-amber-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5 text-[#9A3412] dark:text-amber-400" />
          <span>{isIOS ? 'Installer sur iOS' : 'Installer l’App'}</span>
        </button>
      )}

      {/* Installation Instructions Modal (iOS Safari or Desktop Manual Install) */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md border border-stone-300 dark:border-stone-800 bg-[#FBF9F5] dark:bg-stone-900 p-6 shadow-2xl text-stone-900 dark:text-stone-100">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-[#9A3412] dark:text-amber-400 shrink-0" />
                <h3
                  id="pwa-install-dialog-title"
                  className="font-serif text-2xl font-semibold"
                >
                  Installer Folio en mode Hors-Ligne
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Fermer la fenêtre d'installation"
                className="p-1 text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
              Folio est une Progressive Web App (PWA) dotée d’un Service Worker et d’un stockage par blocs IndexedDB. Une fois installée, votre bibliothèque est accessible à 100 % sans connexion Internet.
            </p>

            {isIOS ? (
              <ol className="mt-4 space-y-2 text-xs text-stone-700 dark:text-stone-300 border-t border-stone-200 dark:border-stone-800 pt-4">
                <li>
                  1. Touchez l’icône <strong>Partager</strong> dans la barre d’outils de Safari.
                </li>
                <li>
                  2. Faites défiler et sélectionnez <strong>Sur l’écran d’accueil</strong>.
                </li>
                <li>
                  3. Confirmez en touchant <strong>Ajouter</strong>.
                </li>
              </ol>
            ) : (
              <ol className="mt-4 space-y-2 text-xs text-stone-700 dark:text-stone-300 border-t border-stone-200 dark:border-stone-800 pt-4">
                <li>
                  1. Cliquez sur l’icône <strong>Installer Folio</strong> située à droite de la barre d’adresse de votre navigateur (Chrome, Edge, Brave).
                </li>
                <li>
                  2. Ou ouvrez le menu du navigateur et choisissez <strong>Installer l’application</strong>.
                </li>
              </ol>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#1C1917] hover:bg-[#9A3412] dark:bg-stone-100 dark:text-stone-900 transition-colors cursor-pointer"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
