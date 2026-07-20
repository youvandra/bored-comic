import { continueRender, delayRender, staticFile } from "remotion";

export const C = {
  bg: "#0c0e1d",
  bg2: "#141733",
  ink: "#0a0a12",
  paper: "#fdf6e3",
  white: "#ffffff",
  yellow: "#ffc833",
  red: "#ff4757",
  teal: "#3ee6c1",
  purple: "#8f7bff",
  dim: "#8b93b8",
  green: "#4ade80",
  term: "#0d1220",
};

export const FONT_TITLE = "Bangers, sans-serif";
export const FONT_BODY = "'Comic Neue', sans-serif";
export const FONT_MONO = "Menlo, 'SF Mono', monospace";

let loaded = false;
export const loadFonts = () => {
  if (loaded) return;
  loaded = true;
  const handle = delayRender("fonts", { timeoutInMilliseconds: 120000 });
  const bangers = new FontFace("Bangers", `url('${staticFile("Bangers-Regular.ttf")}')`);
  const comic = new FontFace("Comic Neue", `url('${staticFile("ComicNeue-Bold.ttf")}')`, { weight: "700" });
  Promise.all([bangers.load(), comic.load()])
    .then((fonts) => {
      fonts.forEach((f) => (document as any).fonts.add(f));
      continueRender(handle);
    })
    .catch(() => continueRender(handle));
};
