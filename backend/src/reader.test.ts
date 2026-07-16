import { test } from "node:test";
import assert from "node:assert/strict";

test("escapeHtml neutralizes markup in LLM-authored strings", async () => {
  const { escapeHtml } = await import("./reader.js");
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(escapeHtml("Tom & Jerry's <BIG> day"), "Tom &amp; Jerry&#39;s &lt;BIG&gt; day");
});

test("escapeJsonForScript prevents </script> breakout", async () => {
  const { escapeJsonForScript } = await import("./reader.js");
  const out = escapeJsonForScript({ title: `</script><img onerror=x>` });
  assert.ok(!out.includes("</script>"));
  assert.ok(out.includes("\\u003c/script"));
  // Still valid JSON that round-trips.
  assert.equal(JSON.parse(out).title, "</script><img onerror=x>");
});

test("renderReaderPage injects escaped fields and payload", async () => {
  const { renderReaderPage } = await import("./reader.js");

  const now = new Date().toISOString();
  const html = renderReaderPage({
    job: {
      jobId: "cg_r1",
      input: { prompt: "x", pages: 1, genre: "action", style: "manga" },
      storyboard: { title: `Neon <"Pursuit">`, synopsis: "A chase & a secret.", characters: [], pages: [] },
      seed: 1,
      pageW: 800,
      pageH: 1067,
      layoutMode: "page",
      characterIds: [],
      delivery: {
        title: `Neon <"Pursuit">`,
        genre: "action",
        style: "manga",
        coverUrl: "/comics/cg_r1/cover.png",
        pageUrls: ["/comics/cg_r1/cover.png", "/comics/cg_r1/page-1.png"],
      } as never,
      createdAt: now,
      updatedAt: now,
    },
    views: 42,
    filesAvailable: true,
  });

  assert.ok(html.includes("Neon &lt;&quot;Pursuit&quot;&gt;")); // escaped title
  assert.ok(!html.includes(`Neon <"Pursuit">`)); // raw never leaks
  assert.ok(html.includes("42 READS"));
  assert.ok(html.includes("ACTION"));
  assert.ok(html.includes(`"pageUrls":["/comics/cg_r1/cover.png","/comics/cg_r1/page-1.png"]`));
  assert.ok(html.includes(`og:image`));
  assert.ok(html.includes("%%") === false, "no unreplaced template tokens");
});
