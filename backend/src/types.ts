export type Genre = "horror" | "romance" | "action" | "comedy" | "manga" | "fantasy" | "sci-fi" | "slice-of-life";
export type ComicStyle = "manga" | "western" | "semi-realistic" | "chibi";
export type ColorMode = "color" | "bw";
export type LayoutMode = "page" | "webtoon";

export interface Character {
  name: string;
  role: string;
  appearance: string;
}

// ——— Persistent store records ———

// A registered character: canonical appearance text + a stable seed so the
// same character can appear across many comics with a consistent baseline.
export interface StoredCharacter {
  characterId: string;
  name: string;
  role: string;
  appearance: string;
  style: ComicStyle;
  seed: number;
  referenceUrl: string | null; // generated character-sheet image
  createdAt: string;
  updatedAt: string;
}

export interface SeriesEpisode {
  episode: number;
  jobId: string;
  title: string;
  synopsis: string;
  endingSummary: string;
  createdAt: string;
}

// An ongoing series: fixed cast + episode history the writer uses as context.
export interface StoredSeries {
  seriesId: string;
  title: string;
  genre?: Genre;
  style?: ComicStyle;
  language?: string;
  colorMode?: ColorMode;
  characterIds: string[];
  episodes: SeriesEpisode[];
  createdAt: string;
  updatedAt: string;
}

// Everything needed to revise a page after delivery: storyboard, seed, dims.
// The full delivery payload is kept so get_job can re-serve a paid result
// whose response was lost (connection drop, proxy timeout).
export interface StoredJob {
  jobId: string;
  input: GenerateComicInput;
  storyboard: Storyboard;
  seed: number;
  pageW: number;
  pageH: number;
  layoutMode: LayoutMode;
  characterIds: string[];
  seriesId?: string;
  delivery?: ComicDelivery;
  createdAt: string;
  updatedAt: string;
}

export type DialogueType = "speech" | "shout" | "thought";

export interface PanelDescription {
  panel: number;
  scene: string;
  characters: string[];
  dialogue?: string;
  dialogueType?: DialogueType;
  dialogue2?: string; // second speaker's line, when two characters talk in one panel
  dialogue2Type?: DialogueType;
  sfx?: string; // onomatopoeia word art, e.g. "POW", "CRASH" — action panels only
  cameraAngle?: string;
}

export interface PageSpec {
  page: number;
  panels: number;
  storyBeat: string;
  panelDescriptions: PanelDescription[];
}

export interface Storyboard {
  title: string;
  synopsis: string;
  characters: Character[];
  pages: PageSpec[];
  // 1-2 sentences describing where the story ends — stored per episode so the
  // next episode in a series can continue from it.
  endingSummary?: string;
}

// Layout: position and size as percentage of page dimensions
export interface PanelLayout {
  panelIndex: number;
  x: number; // 0-1 (percent)
  y: number;
  w: number;
  h: number;
}

export interface PageEvidence {
  model: string;
  promptChars: number;
  characterCount: number;
  layout: string;
  caveat: string;
}

// Per-panel export: raw art + accessibility alt text + the lettering content.
// Lets an agent quote a single panel or caption it without image analysis.
export interface PanelDetail {
  panel: number;
  imageUrl: string;
  altText: string;
  dialogue?: string;
  dialogue2?: string;
  sfx?: string;
  cameraAngle?: string;
}

export interface PageResult {
  page: number;
  panels: number;
  storyBeat: string;
  imageUrl: string;
  panelDetails: PanelDetail[];
  evidence: PageEvidence;
}

// Self-grading: a vision model inspects every delivered page and reports what
// it sees, so the paying agent gets an independent quality signal it can act
// on (accept, retry, revise) without running its own image analysis.
export interface PageQuality {
  page: number;
  score: number; // 1-10
  notes: string;
}

export interface QualityReport {
  model: string;
  averageScore: number;
  pages: PageQuality[];
  caveat: string;
}

export interface ComicEvidence {
  model: string;
  pagesGenerated: number;
  panelsGenerated: number;
  generationTimeSec: number;
  costEstimateUsd: number;
  language: string;
  colorMode: ColorMode;
  qualityReport?: QualityReport;
  caveat: string;
}

// SHA-256 of every delivered file, keyed by filename. The payer can verify
// the bytes they downloaded are the bytes they paid for.
export interface DeliveryIntegrity {
  algorithm: "sha256";
  files: Record<string, string>;
}

// Signed proof of delivery. signature is HMAC-SHA256 over
// `${jobId}.${payloadSha256}.${issuedAt}` with the server's receipt key.
export interface DeliveryReceipt {
  jobId: string;
  issuedAt: string;
  payloadSha256: string;
  algorithm: "HMAC-SHA256";
  signature: string | null;
  note: string;
}

export interface DeliveryLicense {
  usage: string;
  attribution: string;
  aiDisclosure: string;
  provenance: {
    imageModel: string;
    seed: number;
    promptSha256: string;
  };
}

export interface ComicDelivery {
  jobId: string;
  summary: string;
  title: string;
  pages: number;
  totalPanels: number;
  style: ComicStyle;
  genre: Genre;
  language: string;
  colorMode: ColorMode;
  layoutMode: LayoutMode;
  characters: Character[];
  characterIds?: string[];
  seriesId?: string;
  episode?: number;
  coverUrl: string;
  pageUrls: string[];
  pdfUrl: string;
  cbzUrl: string;
  stripUrl?: string; // webtoon mode: all pages as one vertical strip
  readerUrl: string; // hosted swipeable web reader for this comic
  perPage: PageResult[];
  integrity: DeliveryIntegrity;
  receipt: DeliveryReceipt;
  license: DeliveryLicense;
  evidence: ComicEvidence;
}

export interface GenerateComicInput {
  prompt: string;
  genre?: Genre;
  pages: number;
  style?: ComicStyle;
  aspectRatio?: "3:4" | "9:16" | "1:1";
  language?: string;
  colorMode?: ColorMode;
  layoutMode?: LayoutMode;
  characterIds?: string[];
  seriesId?: string;
}

export const MAX_PAGES = 10;
export const MIN_PAGES = 1;

// Layout templates for 1-4 panels on a 3:4 page
// All aspect ratios kept reasonable (between 1:2 and 2:1) for 1:1 FLUX images
// Positions as fractions of page width/height, GUTTER = 12px
const LAYOUTS: Record<number, PanelLayout[][]> = {
  1: [
    [{ panelIndex: 0, x: 0, y: 0, w: 1, h: 1 }],
  ],
  2: [
    // Split horizontal (50/50)
    [{ panelIndex: 0, x: 0, y: 0, w: 0.5, h: 1 }, { panelIndex: 1, x: 0.5, y: 0, w: 0.5, h: 1 }],
    // Split vertical (50/50)
    [{ panelIndex: 0, x: 0, y: 0, w: 1, h: 0.5 }, { panelIndex: 1, x: 0, y: 0.5, w: 1, h: 0.5 }],
    // 60/40 split vertical (top panel bigger)
    [{ panelIndex: 0, x: 0, y: 0, w: 1, h: 0.6 }, { panelIndex: 1, x: 0, y: 0.6, w: 1, h: 0.4 }],
    // 60/40 split horizontal
    [{ panelIndex: 0, x: 0, y: 0, w: 0.6, h: 1 }, { panelIndex: 1, x: 0.6, y: 0, w: 0.4, h: 1 }],
  ],
  3: [
    // Top wide panel, bottom 2-col
    [{ panelIndex: 0, x: 0, y: 0, w: 1, h: 0.5 }, { panelIndex: 1, x: 0, y: 0.5, w: 0.5, h: 0.5 }, { panelIndex: 2, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
    // Top 2-col, bottom wide panel
    [{ panelIndex: 0, x: 0, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 1, x: 0.5, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 2, x: 0, y: 0.5, w: 1, h: 0.5 }],
    // 3 equal columns
    [{ panelIndex: 0, x: 0, y: 0, w: 0.33, h: 1 }, { panelIndex: 1, x: 0.33, y: 0, w: 0.34, h: 1 }, { panelIndex: 2, x: 0.67, y: 0, w: 0.33, h: 1 }],
    // Left half, right 2-stack
    [{ panelIndex: 0, x: 0, y: 0, w: 0.5, h: 1 }, { panelIndex: 1, x: 0.5, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 2, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
    // 3 equal rows
    [{ panelIndex: 0, x: 0, y: 0, w: 1, h: 0.33 }, { panelIndex: 1, x: 0, y: 0.33, w: 1, h: 0.34 }, { panelIndex: 2, x: 0, y: 0.67, w: 1, h: 0.33 }],
  ],
  4: [
    // Classic 2x2 grid
    [{ panelIndex: 0, x: 0, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 1, x: 0.5, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 2, x: 0, y: 0.5, w: 0.5, h: 0.5 }, { panelIndex: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
    // Top wide, bottom 3-col
    [{ panelIndex: 0, x: 0, y: 0, w: 1, h: 0.5 }, { panelIndex: 1, x: 0, y: 0.5, w: 0.33, h: 0.5 }, { panelIndex: 2, x: 0.33, y: 0.5, w: 0.34, h: 0.5 }, { panelIndex: 3, x: 0.67, y: 0.5, w: 0.33, h: 0.5 }],
    // Top 2-col, bottom 2-col (uneven)
    [{ panelIndex: 0, x: 0, y: 0, w: 0.5, h: 0.45 }, { panelIndex: 1, x: 0.5, y: 0, w: 0.5, h: 0.45 }, { panelIndex: 2, x: 0, y: 0.45, w: 0.5, h: 0.55 }, { panelIndex: 3, x: 0.5, y: 0.45, w: 0.5, h: 0.55 }],
    // Left 2-stack, right 2-stack
    [{ panelIndex: 0, x: 0, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 1, x: 0, y: 0.5, w: 0.5, h: 0.5 }, { panelIndex: 2, x: 0.5, y: 0, w: 0.5, h: 0.5 }, { panelIndex: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
  ],
};

export function pickLayout(
  panelCount: number,
  prevLayout: PanelLayout[] | null,
  firstCameraAngle?: string,
  preferHero = false,
): PanelLayout[] {
  const opts = LAYOUTS[panelCount];
  if (!opts || opts.length === 0) {
    return Array.from({ length: panelCount }, (_, i) => ({
      panelIndex: i,
      x: (i % 2) * 0.5,
      y: Math.floor(i / 2) * 0.5,
      w: 0.5,
      h: 0.5,
    }));
  }

  // Always avoid same layout as previous page
  const prevKey = prevLayout ? prevLayout.map((l) => `${l.x},${l.y},${l.w},${l.h}`).join("|") : "";

  // Score each layout by suitability
  const scored = opts.map((layout, idx) => {
    let score = Math.random();
    const key = layout.map((l) => `${l.x},${l.y},${l.w},${l.h}`).join("|");

    // Penalize same as previous page
    if (key === prevKey) score -= 10;

    // First panel gets more space for establishing shots
    const firstPanelW = layout[0].w * layout[0].h;
    if (firstCameraAngle) {
      const wideAngles = ["wide", "establishing", "long", "birds eye", "aerial"];
      const isWide = wideAngles.some((a) => firstCameraAngle.toLowerCase().includes(a));
      if (isWide && firstPanelW > 0.3) score += 3;
      if (!isWide && firstPanelW > 0.4) score -= 1;
    }

    // Climax page: strongly favor a dominant hero/splash panel for payoff.
    if (preferHero) {
      const biggest = Math.max(...layout.map((l) => l.w * l.h));
      if (biggest > 0.45) score += 5;
    }

    // Prefer variety: layouts with different shapes
    const uniqueShapes = new Set(layout.map((l) => `${Math.round(l.w * 10)},${Math.round(l.h * 10)}`)).size;
    score += uniqueShapes * 0.5;

    return { layout, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].layout;
}
