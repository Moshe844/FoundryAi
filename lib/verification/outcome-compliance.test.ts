import { describe, expect, it } from "vitest";
import { complianceVerdict, deriveOutcomeAssertions, type FileChange } from "@/lib/verification/outcome-compliance";

const verdict = (request: string, before: string, after: string) =>
  complianceVerdict(deriveOutcomeAssertions(request, [{ path: "index.html", before, after } satisfies FileChange])).status;

describe("compound remove-and-add requests are not misread as failed removals", () => {
  // The exact request that hard-failed forever: it removed the images but the checker demanded the
  // WORDS "images"/"able" vanish — words the upload feature legitimately keeps.
  const request = "remove all the pre added images, and make the ability I should be able to upload my own images";
  const withImages = '<body><img src="a.jpg"><img src="b.jpg"><p>gallery of images</p></body>';
  const imagesRemovedUploadAdded = '<body><input type="file" accept="image/*" multiple><p>upload your own images</p></body>';
  const imagesRemovedNoUpload = '<body><p>upload your own images</p></body>';

  it("does not report a violation when the images were removed (upload present)", () => {
    expect(verdict(request, withImages, imagesRemovedUploadAdded)).not.toBe("violated");
  });

  it("does not report a violation even if only the removal half happened", () => {
    // The removal is genuinely done; the addition is a separate concern the browser gate/model judge.
    // What must NOT happen is a false "removal not carried out" because the word "images" survived.
    expect(verdict(request, withImages, imagesRemovedNoUpload)).not.toBe("violated");
  });
});

describe("simple single-clause removals still work", () => {
  it("violated when the removal did not happen", () => {
    expect(verdict("remove the export button", "<button>export</button>", "<button>export</button><span/>")).toBe("violated");
  });
  it("satisfied when the removal happened", () => {
    expect(verdict("remove the export button", "<button>export</button>", "<div/>")).toBe("satisfied");
  });
});

describe("token matching respects identifier boundaries", () => {
  it('"able" (from "able to upload") does not match "available"/"disabled"/"table"', () => {
    // A pure removal naming "able" must not be satisfied/violated off unrelated words.
    const status = verdict("remove the able section", "<div>the table is available but disabled</div>", "<div>the table is available but disabled</div>");
    // "able" is not a real segment in the source, so removal is indeterminate — never a false violation.
    expect(status).not.toBe("violated");
  });

  it('"total" still matches identifier segments like totalSpend', () => {
    expect(verdict("remove the total", "<span>{totalSpend}</span>", "<span>{totalSpend}</span>")).toBe("violated");
    expect(verdict("remove the total", "<span>{totalSpend}</span>", "<div/>")).toBe("satisfied");
  });
});
