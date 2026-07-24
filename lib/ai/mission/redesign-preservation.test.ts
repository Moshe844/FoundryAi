import { describe, expect, it } from "vitest";
import { existingPageContentPreservationIssue, requestsContentReplacement } from "@/lib/ai/mission/executor";
import type { ProjectAccess } from "@/lib/ai/mission/project-access";

const originalPage = `<!doctype html><html><head><title>Acme Payments Test</title></head><body>
  <h1>Acme Payments Sandbox</h1>
  <p>Enter a card number and amount to simulate a charge against the Acme test gateway.</p>
  <label>Card number</label><input id="card">
  <label>Amount in dollars</label><input id="amount">
  <button id="charge">Run test charge</button>
  <section><h2>Recent simulated transactions</h2><ul><li>Visa 4242 approved</li><li>Mastercard declined insufficient funds</li></ul></section>
</body></html>`;

const accessWith = (content: string): ProjectAccess =>
  ({
    readFile: async () => ({ exists: true, content, truncated: false }),
  }) as unknown as ProjectAccess;

describe("requestsContentReplacement — only explicit content changes opt out of preservation", () => {
  // Every one of these is a look/feel request. None should be read as a content change, no matter the
  // adjective — that is the whole point: the guard must not depend on recognizing aesthetic words.
  const preserveContent = [
    "redesign the UX to be more beautiful",
    "make my payment test page beautiful",
    "make it look cool",
    "make it nice",
    "make it stunning",
    "make it slick and sleek",
    "give it a gorgeous modern look",
    "snazz it up",
    "make it pop",
    "just make it prettier",
    "improve the visual design",
    "clean up the layout and spacing",
    "add a hero section at the top",
    "fix the alignment of the buttons",
  ];
  for (const t of preserveContent) {
    it(`preserves content: ${t}`, () => expect(requestsContentReplacement(t)).toBe(false));
  }

  const replaceContent = [
    "rewrite the copy on the homepage",
    "replace the text content with the new marketing copy",
    "change the wording to reflect 2026 pricing",
    "build a new website from scratch",
    "start over with a coming-soon page",
    "swap the paragraphs for the new blurb",
    "wipe the page and put a placeholder site",
  ];
  for (const t of replaceContent) {
    it(`allows content replacement: ${t}`, () => expect(requestsContentReplacement(t)).toBe(true));
  }
});

describe("existingPageContentPreservationIssue — reads the diff, not the request", () => {
  it("rejects an edit that replaced the content with a different site", async () => {
    const brandNewSite = `<!doctype html><html><body>
      <h1>Bloom Florist Studio</h1>
      <p>Handcrafted bouquets delivered across the city, made fresh every morning.</p>
      <button>Order flowers</button>
      <section><h2>Our seasonal collections</h2><ul><li>Spring tulips</li><li>Autumn dahlias</li></ul></section>
    </body></html>`;
    const issue = await existingPageContentPreservationIssue(accessWith(originalPage), "index.html", brandNewSite);
    expect(issue).toMatch(/replacing the user's existing content|change it in place/i);
  });

  it("accepts an edit that kept the content but changed styling and markup", async () => {
    const restyled = `<!doctype html><html><head><style>body{font-family:Inter;background:#0b1020;color:#fff}.card{border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.4)}</style></head><body>
      <header class="hero"><h1>Acme Payments Sandbox</h1></header>
      <main class="card"><p>Enter a card number and amount to simulate a charge against the Acme test gateway.</p>
      <label>Card number</label><input id="card">
      <label>Amount in dollars</label><input id="amount">
      <button id="charge" class="btn-primary">Run test charge</button></main>
      <section class="card"><h2>Recent simulated transactions</h2><ul><li>Visa 4242 approved</li><li>Mastercard declined insufficient funds</li></ul></section>
    </body></html>`;
    expect(await existingPageContentPreservationIssue(accessWith(originalPage), "index.html", restyled)).toBeUndefined();
  });

  it("accepts an edit that keeps the content and adds more", async () => {
    const restyledPlus = originalPage.replace("</body>", "<footer><p>Contact support at help@acme.test for gateway issues.</p></footer></body>");
    expect(await existingPageContentPreservationIssue(accessWith(originalPage), "index.html", restyledPlus)).toBeUndefined();
  });

  it("does not judge a near-empty original page", async () => {
    const tiny = "<!doctype html><html><body><h1>Hi</h1></body></html>";
    expect(await existingPageContentPreservationIssue(accessWith(tiny), "index.html", "<html><body><h1>Totally different</h1></body></html>")).toBeUndefined();
  });
});
