/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SyntheticChapter {
  readonly chapterNumber: string;
  readonly title: string;
  readonly subtitle: string;
  readonly paragraphs: readonly string[];
  readonly pullQuote?: string;
}

export interface SyntheticBookSpec {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly collectionName: string;
  readonly publicationYear: string;
  readonly accentRgb: readonly [number, number, number];
  readonly chapters: readonly SyntheticChapter[];
  readonly initialPage: number;
  readonly initialBookmarks: readonly number[];
}

/**
 * Sanitizes French/Latin-1 text to WinAnsiEncoding byte codes for standard PDF Type1 fonts.
 */
function toPdfLiteralString(input: string): string {
  const normalized = input
    .replace(/’/g, "'")
    .replace(/‘/g, "'")
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/…/g, '...')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE');

  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    const ch = normalized[i];
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += '\\' + ch;
    } else if (code >= 32 && code <= 126) {
      out += ch;
    } else if (code >= 160 && code <= 255) {
      out += '\\' + code.toString(8).padStart(3, '0');
    } else {
      out += ' ';
    }
  }
  return `(${out})`;
}

/**
 * Word-wraps a paragraph into lines of at most `maxChars` characters.
 */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/**
 * Builds a complete, standards-compliant multi-page binary PDF document (PDF 1.4)
 * with cover typography, editorial running headers, body text, pull quotes, and
 * a hierarchical PDF Outline (Table of Contents) that `pdfjs-dist` parses natively.
 */
export function buildSyntheticPdfBlob(spec: SyntheticBookSpec): Blob {
  const pageStreams: string[] = [];
  const totalPages = spec.chapters.length + 1; // Page 1 = Cover, Pages 2..N = Chapters
  const [r, g, b] = spec.accentRgb;
  const rf = (r / 255).toFixed(3);
  const gf = (g / 255).toFixed(3);
  const bf = (b / 255).toFixed(3);

  // Page 1: Editorial Monograph Cover Page
  const coverOps: string[] = [
    // Subtle cream architectural frame
    '0.985 0.976 0.960 rg',
    '0 0 595 842 re f',
    // Top accent bar
    `${rf} ${gf} ${bf} rg`,
    '56 760 483 4 re f',
    // Outer double hairline border
    '0.78 0.75 0.70 RG',
    '0.75 w',
    '56 56 483 730 re S',
    '62 62 471 718 re S',
    // Collection header kicker
    'BT',
    '/F2 9 Tf',
    '0.45 0.42 0.39 rg',
    `84 718 Td ${toPdfLiteralString(spec.collectionName.toUpperCase())} Tj`,
    'ET',
    // Main Title (wrapped if needed)
    'BT',
    '/F3 30 Tf',
    '0.11 0.10 0.09 rg',
  ];

  const titleLines = wrapText(spec.title, 26);
  let titleY = 635;
  for (const line of titleLines) {
    coverOps.push(`84 ${titleY} Td ${toPdfLiteralString(line)} Tj`);
    coverOps.push(`-84 -${titleY} Td`);
    titleY -= 38;
  }
  coverOps.push('ET');

  // Author & Year
  coverOps.push(
    'BT',
    '/F4 15 Tf',
    `${rf} ${gf} ${bf} rg`,
    `84 ${titleY - 18} Td ${toPdfLiteralString(spec.author)} Tj`,
    'ET'
  );

  // Central geometric architectural illustration on the cover
  const artTop = titleY - 70;
  const artBottom = 180;
  const artHeight = Math.max(160, artTop - artBottom);
  coverOps.push(
    '0.94 0.92 0.89 rg',
    `84 ${artBottom} 427 ${artHeight} re f`,
    `${rf} ${gf} ${bf} RG`,
    '1.2 w',
    `114 ${artBottom + 28} 367 ${artHeight - 56} re S`,
    // Architectural golden ratio grid lines inside cover illustration
    '0.65 0.61 0.56 RG',
    '0.6 w',
    `297 ${artBottom + 28} m 297 ${artBottom + artHeight - 28} l S`,
    `114 ${artBottom + Math.floor(artHeight / 2)} m 481 ${artBottom + Math.floor(artHeight / 2)} l S`,
    `${rf} ${gf} ${bf} rg`,
    `265 ${artBottom + Math.floor(artHeight / 2) - 32} 64 64 re f`
  );

  // Footer colophon on cover
  coverOps.push(
    'BT',
    '/F2 9 Tf',
    '0.40 0.38 0.35 rg',
    `84 102 Td ${toPdfLiteralString(`ÉDITIONS FOLIO ARCHIVES · ${spec.publicationYear} · ÉDITION INTÉGRALE HAUTE RÉSOLUTION`)} Tj`,
    'ET'
  );

  pageStreams.push(coverOps.join('\n'));

  // Subsequent Pages: Chapters
  spec.chapters.forEach((chapter, idx) => {
    const pageNum = idx + 2;
    const ops: string[] = [
      // Paper background
      '0.996 0.992 0.984 rg',
      '0 0 595 842 re f',
      // Running header hairline
      '0.84 0.81 0.77 RG',
      '0.5 w',
      '68 776 m 527 776 l S',
      // Running header text
      'BT',
      '/F2 8.5 Tf',
      '0.48 0.45 0.42 rg',
      `68 788 Td ${toPdfLiteralString(spec.title.toUpperCase())} Tj`,
      'ET',
      'BT',
      '/F2 8.5 Tf',
      '0.48 0.45 0.42 rg',
      `460 788 Td ${toPdfLiteralString(`CHAPITRE ${chapter.chapterNumber}`)} Tj`,
      'ET',
      // Chapter Kicker
      'BT',
      '/F2 10 Tf',
      `${rf} ${gf} ${bf} rg`,
      `68 730 Td ${toPdfLiteralString(`CHAPITRE ${chapter.chapterNumber}  ·  ${chapter.subtitle.toUpperCase()}`)} Tj`,
      'ET',
      // Chapter Title
      'BT',
      '/F3 22 Tf',
      '0.11 0.10 0.09 rg',
      `68 696 Td ${toPdfLiteralString(chapter.title)} Tj`,
      'ET',
      // Decorative chapter rule
      `${rf} ${gf} ${bf} RG`,
      '1.2 w',
      '68 678 m 148 678 l S',
    ];

    let cursorY = 642;

    for (let pIndex = 0; pIndex < chapter.paragraphs.length; pIndex++) {
      const para = chapter.paragraphs[pIndex];
      const wrapped = wrapText(para, 72);

      ops.push('BT', '/F1 11.5 Tf', '0.16 0.15 0.14 rg');
      for (const line of wrapped) {
        if (cursorY < 110) break;
        ops.push(`68 ${cursorY} Td ${toPdfLiteralString(line)} Tj`);
        ops.push(`-68 -${cursorY} Td`);
        cursorY -= 18;
      }
      ops.push('ET');
      cursorY -= 12;

      // Insert editorial pull-quote after first paragraph if present
      if (pIndex === 0 && chapter.pullQuote && cursorY > 220) {
        cursorY -= 6;
        ops.push(
          '0.96 0.94 0.91 rg',
          `68 ${cursorY - 54} 459 64 re f`,
          '0.80 0.76 0.70 RG',
          '0.6 w',
          `68 ${cursorY + 10} m 527 ${cursorY + 10} l S`,
          `68 ${cursorY - 54} m 527 ${cursorY - 54} l S`
        );
        const quoteLines = wrapText(`« ${chapter.pullQuote} »`, 62);
        ops.push('BT', '/F4 12 Tf', '0.18 0.16 0.14 rg');
        let qY = cursorY - 14;
        for (const qLine of quoteLines.slice(0, 2)) {
          ops.push(`82 ${qY} Td ${toPdfLiteralString(qLine)} Tj`);
          ops.push(`-82 -${qY} Td`);
          qY -= 18;
        }
        ops.push('ET');
        cursorY -= 78;
      }
    }

    // Bottom page folio
    ops.push(
      '0.84 0.81 0.77 RG',
      '0.5 w',
      '68 72 m 527 72 l S',
      'BT',
      '/F2 9 Tf',
      '0.45 0.42 0.39 rg',
      `272 52 Td ${toPdfLiteralString(`—  ${pageNum} / ${totalPages}  —`)} Tj`,
      'ET'
    );

    pageStreams.push(ops.join('\n'));
  });

  // Assemble PDF Object Graph
  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Times-Roman)
  // 4: Font F2 (Helvetica)
  // 5: Font F3 (Times-Bold)
  // 6: Font F4 (Times-Italic)
  // 7: Outlines Root
  // 8 .. 8 + chapCount - 1: Outline Items
  // Next: Page objects & Content Stream objects

  const chapCount = spec.chapters.length;
  const firstOutlineItemId = 8;
  const firstPageObjId = firstOutlineItemId + chapCount;

  const objects: Map<number, string> = new Map();

  // Fonts
  objects.set(
    3,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>'
  );
  objects.set(
    4,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  objects.set(
    5,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>'
  );
  objects.set(
    6,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>'
  );

  const pageObjIds: number[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageObjId = firstPageObjId + i * 2;
    const contentObjId = pageObjId + 1;
    pageObjIds.push(pageObjId);

    const streamContent = pageStreams[i];
    objects.set(
      contentObjId,
      `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`
    );

    objects.set(
      pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
  }

  // Outlines (Table of Contents)
  for (let c = 0; c < chapCount; c++) {
    const itemId = firstOutlineItemId + c;
    const targetPageObjId = pageObjIds[c + 1]; // Chapter 1 is on Page 2 (index 1)
    const prevStr = c > 0 ? `/Prev ${itemId - 1} 0 R ` : '';
    const nextStr = c < chapCount - 1 ? `/Next ${itemId + 1} 0 R ` : '';
    const chap = spec.chapters[c];
    const outlineTitle = `${chap.chapterNumber}. ${chap.title}`;

    objects.set(
      itemId,
      `<< /Title ${toPdfLiteralString(outlineTitle)} /Parent 7 0 R ${prevStr}${nextStr}/Dest [${targetPageObjId} 0 R /XYZ 0 842 null] >>`
    );
  }

  objects.set(
    7,
    `<< /Type /Outlines /First ${firstOutlineItemId} 0 R /Last ${
      firstOutlineItemId + chapCount - 1
    } 0 R /Count ${chapCount} >>`
  );

  // Pages Root
  const kidsArray = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects.set(
    2,
    `<< /Type /Pages /Kids [${kidsArray}] /Count ${totalPages} >>`
  );

  // Info Dictionary Object
  const infoObjId = firstPageObjId + totalPages * 2;
  objects.set(
    infoObjId,
    `<< /Title ${toPdfLiteralString(spec.title)} /Author ${toPdfLiteralString(
      spec.author
    )} /Creator (Folio Editions) >>`
  );

  // Catalog Root
  objects.set(
    1,
    `<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /PageMode /UseOutlines >>`
  );

  // Serialize PDF with accurate byte offsets
  let pdfText = '%PDF-1.4\n';
  const offsets: number[] = [0];
  const maxObjId = infoObjId;

  for (let id = 1; id <= maxObjId; id++) {
    offsets[id] = pdfText.length;
    const body = objects.get(id) ?? 'null';
    pdfText += `${id} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = pdfText.length;
  pdfText += `xref\n0 ${maxObjId + 1}\n`;
  pdfText += '0000000000 65535 f \n';
  for (let id = 1; id <= maxObjId; id++) {
    const offStr = String(offsets[id]).padStart(10, '0');
    pdfText += `${offStr} 00000 n \n`;
  }

  pdfText += `trailer\n<< /Size ${
    maxObjId + 1
  } /Root 1 0 R /Info ${infoObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  // Encode Latin-1 1:1 into Uint8Array so byte offsets match character offsets
  const bytes = new Uint8Array(pdfText.length);
  for (let i = 0; i < pdfText.length; i++) {
    bytes[i] = pdfText.charCodeAt(i) & 0xff;
  }

  return new Blob([bytes], { type: 'application/pdf' });
}

export const CURATED_SEED_BOOKS: readonly SyntheticBookSpec[] = [
  {
    id: 'seed-architecture-lumiere',
    title: "L'Architecture de la Lumière",
    author: 'Henri Labrouste & Atelier',
    collectionName: 'Monographies Architecturales · Vol. XIV',
    publicationYear: '2026',
    accentRgb: [154, 52, 18], // Terracotta (#9A3412)
    initialPage: 2,
    initialBookmarks: [2, 4],
    chapters: [
      {
        chapterNumber: '01',
        title: 'Le Vide et la Structure Métallique',
        subtitle: 'Fondations de la bibliothèque moderne',
        pullQuote:
          "La lumière n'est pas un simple ornement de l'espace : elle en constitue la charpente invisible et la mesure première.",
        paragraphs: [
          "Au tournant du XIXe siècle, l'architecture des grandes salles de lecture publiques connaît une mutation radicale. L'introduction des colonnes de fonte élancées et des voûtes diaphanes permet enfin d'ouvrir généreusement les façades à la clarté zénithale et latérale.",
          "Dans la salle de lecture de la Bibliothèque Sainte-Geneviève, la structure cesse d'être dissimulée derrière des parements massifs. Les nervures métalliques dessinent dans l'espace une calligraphie rigoureuse qui guide le regard du lecteur vers le silence de la voûte.",
          "Chaque travée est calculée selon l'angle d'incidence du soleil aux différentes heures du jour. Les tables de chêne massif s'alignent dans l'axe des hautes fenêtres en plein cintre, assurant une luminance constante sur le grain du papier sans jamais éblouir la rétine.",
        ],
      },
      {
        chapterNumber: '02',
        title: 'Esthétique du Papier et Contraste Optique',
        subtitle: 'Physiologie de la lecture prolongée',
        pullQuote:
          "Une page bien composée respire par ses marges autant que par la netteté de son encre.",
        paragraphs: [
          "La fatigue oculaire résulte rarement de la petitesse des caractères, mais presque toujours d'un déséquilibre entre la réflectance du support et la densité typographique de la ligne. C'est pourquoi les imprimeurs humanistes privilégiaient les papiers vergés légèrement ivoire.",
          "L'adaptation numérique des grands textes exige la même discipline optique : offrir au lecteur le choix entre la fraîcheur d'un papier blanc d'archive, la douceur ambrée du sépia vénitien et le repos nocturne d'un fond ardoise à contraste maîtrisé.",
          "Les proportions canoniques définies par Villard de Honnecourt réservaient un tiers de la surface de la feuille aux marges extérieures et inférieures, offrant aux pouces un espace de repos naturel qui préserve l'intégrité du texte.",
        ],
      },
      {
        chapterNumber: '03',
        title: 'La Typographie comme Silence Visuel',
        subtitle: 'Rythme vertical et cadences éditoriales',
        pullQuote:
          "La typographie véritablement réussie s'efface devant la pensée de l'auteur comme le verre limpide devant le paysage.",
        paragraphs: [
          "Le dessin d'une police à empattements destinée à la lecture au long cours repose sur une tension subtile entre la régularité du gris typographique et la singularité organique de chaque glyphe. Les pleins et déliés de Garamond guident l'oeil horizontalement sans effort conscient.",
          "Lorsqu'un ouvrage est consulté en double page, la symétrie des deux colonnes crée un champ visuel unifié. Le pli central agit comme un pivot géométrique autour duquel s'équilibrent les titres courants, les notes marginales et les folios numérotés.",
          "Ainsi conçue, la liseuse contemporaine ne rompt pas avec cinq siècles d'art du livre : elle en prolonge la rigueur dans un médium de haute précision.",
        ],
      },
      {
        chapterNumber: '04',
        title: 'Conservation et Mémoire Pérenne',
        subtitle: 'Archivage local et souveraineté du lecteur',
        pullQuote:
          "Une bibliothèque personnelle est un territoire intérieur dont chaque marque-page trace la cartographie intime.",
        paragraphs: [
          "Conserver ses ouvrages localement, avec la garantie de retrouver instantanément la page exacte, le niveau de zoom et les passages annotés, restitue au livre numérique la permanence rassurante d'un volume relié posé sur une table de chevet.",
          "La séparation stricte entre le catalogue de métadonnées et les matrices binaires haute définition permet une navigation immédiate au sein de centaines de volumes sans compromis sur la fidélité de restitution graphique.",
        ],
      },
    ],
  },
  {
    id: 'seed-art-typographie',
    title: "Traité de la Page Imprimée",
    author: 'Élise Valmont',
    collectionName: 'Cahiers de Typographie · Vol. IX',
    publicationYear: '2025',
    accentRgb: [30, 58, 138], // Deep Lapis (#1E3A8A)
    initialPage: 1,
    initialBookmarks: [3],
    chapters: [
      {
        chapterNumber: '01',
        title: "L'Héritage de Claude Garamont",
        subtitle: 'Naissance de la lettre romaine française',
        pullQuote:
          "Tailler un poinçon d'acier, c'est sculpter la lumière intérieure du blanc qui entoure la lettre.",
        paragraphs: [
          "À la Renaissance, les graveurs parisiens substituent à la lourdeur gothique la clarté solaire des capitales romaines associées aux minuscules humanistiques. Cette synthèse fonde pour des siècles la lisibilité du livre européen.",
          "Chaque courbe, chaque empattement triangulaire répond à la mécanique de l'impression sur papier humide : l'encre s'épanouit légèrement dans la fibre végétale, conférant aux textes anciens leur chaleur inimitable.",
        ],
      },
      {
        chapterNumber: '02',
        title: 'Grilles Modulaires et Proportions Dorées',
        subtitle: 'Géométrie de la double page',
        pullQuote:
          "L'harmonie d'une mise en page procède de rapports arithmétiques simples entre la largeur de la colonne et la hauteur de la ligne.",
        paragraphs: [
          "Une ligne trop courte brise le rythme syntaxique de la phrase ; une ligne trop longue égare le regard lors du retour à la ligne suivante. La mesure idéale s'établit invariablement entre soixante et soixante-quinze signes.",
          "Les blancs tournants — petit fond, grand fond, tête et pied — suivent une progression croissante qui ancre visuellement le bloc de texte dans la moitié supérieure de la page ouverte.",
        ],
      },
      {
        chapterNumber: '03',
        title: 'Rendu Haute Densité et Écrans Rétina',
        subtitle: 'De la presse au pixel sub-millimétrique',
        paragraphs: [
          "Avec l'avènement des écrans à très haute densité de pixels, la rastérisation vectorielle des polices PDF atteint une finesse comparable à la photocomposition optique. L'anticrénelage restitue les déliés les plus subtils sans flou.",
          "Le préchargement intelligent de la page suivante garantit une transition imperceptible, respectant le fil ininterrompu de la méditation du lecteur.",
        ],
      },
    ],
  },
  {
    id: 'seed-philosophie-jardin',
    title: 'Poétique du Silence & des Jardins',
    author: 'Kenji Takahashi',
    collectionName: 'Essais Contemplatifs · Vol. III',
    publicationYear: '2026',
    accentRgb: [20, 83, 45], // Forest Ink (#14532D)
    initialPage: 3,
    initialBookmarks: [2, 3],
    chapters: [
      {
        chapterNumber: '01',
        title: "L'Intervalle Spatial (Ma)",
        subtitle: 'La valeur pleine du vide',
        pullQuote:
          "Ce n'est pas la pierre dressée qui fait le jardin, mais la distance silencieuse qui la sépare de la pierre voisine.",
        paragraphs: [
          "Dans l'esthétique classique de Kyoto, l'espace vacant n'est jamais une absence : il est le lieu même où résonne la présence des choses. De même, dans un livre ou une interface épurée, la soustraction de tout élément superflu révèle l'essentiel.",
          "Lorsque l'esprit s'affranchit des sollicitations visuelles parasites, l'attention retrouve sa profondeur naturelle et chaque phrase reprend son poids véritable.",
        ],
      },
      {
        chapterNumber: '02',
        title: 'Mousse, Pierre et Lumière Tamisée',
        subtitle: 'Éloge des nuances feutrées',
        pullQuote:
          "Nous trouvons la beauté non point dans la chose elle-même, mais dans le jeu d'ombres et de clair-obscur qu'elle engendre.",
        paragraphs: [
          "Sous l'auvent profond des pavillons de thé, la clarté du jour traverse le papier végétal des shoji et perd toute dureté. Elle enveloppe les objets d'une lueur égale, propice au recueillement et à l'étude.",
          "C'est cette même qualité d'éclairage feutré que recherche le lecteur attentif lorsqu'il ajuste la teinte de sa page selon l'heure du crépuscule.",
        ],
      },
    ],
  },
];
