// Dev only: `T3TERM_PR_GUIDE_FIXTURE=<file.json>` (a PullRequestReviewGuideResult) stands in for
// every pull request's review guide and shows the Guide tab, so the tour can be checked without
// starting an agent run against a real repository.
import * as NodeFS from "node:fs";

import type { PullRequestReviewGuideResult } from "@t3tools/contracts";

function loadFixture(): PullRequestReviewGuideResult | null {
  const file = process.env.T3TERM_PR_GUIDE_FIXTURE?.trim();
  if (!file) return null;
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8")) as PullRequestReviewGuideResult;
  } catch (error) {
    console.error("Could not read T3TERM_PR_GUIDE_FIXTURE", error);
    return null;
  }
}

export const REVIEW_GUIDE_FIXTURE = loadFixture();
