export type Genre = "horror" | "romance" | "action" | "comedy" | "manga" | "fantasy" | "sci-fi" | "slice-of-life" | "18+";
export type ComicStyle = "manga" | "western" | "semi-realistic" | "chibi";

export interface Character {
  name: string;
  role: string;
  appearance: string;
}

export interface PanelDescription {
  panel: number;
  scene: string;
  characters: string[];
  dialogue?: string;
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
}

export interface PageEvidence {
  model: string;
  promptChars: number;
  characterCount: number;
  caveat: string;
}

export interface PageResult {
  page: number;
  panels: number;
  storyBeat: string;
  imageUrl: string;
  evidence: PageEvidence;
}

export interface ComicEvidence {
  model: string;
  pagesGenerated: number;
  panelsGenerated: number;
  generationTimeSec: number;
  costEstimateUsd: number;
  caveat: string;
}

export interface ComicDelivery {
  jobId: string;
  summary: string;
  title: string;
  pages: number;
  totalPanels: number;
  style: ComicStyle;
  genre: Genre;
  characters: Character[];
  pageUrls: string[];
  pdfUrl: string;
  perPage: PageResult[];
  evidence: ComicEvidence;
}

export interface GenerateComicInput {
  prompt: string;
  genre?: Genre;
  pages: number;
  style?: ComicStyle;
  aspectRatio?: "3:4" | "9:16" | "1:1";
}

export const MAX_PAGES = 10;
export const MIN_PAGES = 1;
