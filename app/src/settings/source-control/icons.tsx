// Version control and hosting marks from apps/web/src/components/Icons.tsx.
// gpuix draws an <svg> in one tint, so each mark uses its dominant brand color.
import type { ReactNode } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { useTheme } from "../../ui/theme.ts";
import { BRAND_SVGS } from "../brandIcons.tsx";

const svg = (viewBox: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="#000">${body}</svg>`;

const SOURCES: Record<string, { source: string; color: string | null }> = {
  git: {
    source: svg(
      "0 0 256 256",
      '<path d="M251.17 116.6 139.4 4.82a16.49 16.49 0 0 0-23.31 0l-23.21 23.2 29.44 29.45a19.57 19.57 0 0 1 24.8 24.96l28.37 28.38a19.61 19.61 0 1 1-11.75 11.06L137.28 95.4v69.64a19.62 19.62 0 1 1-16.13-.57V94.2a19.61 19.61 0 0 1-10.65-25.73L81.46 39.44 4.83 116.08a16.49 16.49 0 0 0 0 23.32L116.6 251.17a16.49 16.49 0 0 0 23.32 0l111.25-111.25a16.5 16.5 0 0 0 0-23.33"/>',
    ),
    color: "#de4c36",
  },
  jj: {
    source: svg("0 0 1024 1024", '<rect width="1024" height="1024" rx="270"/>'),
    color: "#a7bcd9",
  },
  github: { source: BRAND_SVGS.github, color: null },
  gitlab: {
    source: svg(
      "0 0 32 32",
      '<path d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z"/>',
    ),
    color: "#fc6d26",
  },
  bitbucket: {
    source: svg(
      "8.4 14.39 2481.29 2231.21",
      '<path d="M88.92,14.4C45.02,13.83,8.97,48.96,8.41,92.86c-0.06,4.61,0.28,9.22,1.02,13.77l337.48,2048.72 c8.68,51.75,53.26,89.8,105.74,90.24h1619.03c39.38,0.5,73.19-27.9,79.49-66.78l337.49-2071.78c7.03-43.34-22.41-84.17-65.75-91.2 c-4.55-0.74-9.15-1.08-13.76-1.02L88.92,14.4z M1509.99,1495.09H993.24l-139.92-731h781.89L1509.99,1495.09z"/>',
    ),
    color: "#2684ff",
  },
  forgejo: {
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 212 212"><g transform="translate(6 6)" fill="none" stroke="#000"><path d="M58 168 v-98 a50 50 0 0 1 50-50 h20" stroke-width="25"/><path d="M58 168 v-30 a50 50 0 0 1 50-50 h20" stroke-width="25"/><circle cx="142" cy="20" r="18" stroke-width="15"/><circle cx="142" cy="88" r="18" stroke-width="15"/><circle cx="58" cy="180" r="18" stroke-width="15"/></g></svg>`,
    color: "#ff6600",
  },
  gitcafe: { source: svg("0 0 64 64", '<rect x="4.8" y="4.8" width="54.4" height="54.4"/>'), color: "#a78bfa" },
};

/** The mark for a VCS kind (git, jj) or a source control host kind (github, gitlab, ...). */
export function SourceControlMark({ kind, size = 18 }: { kind: string; size?: number }): ReactNode {
  const theme = useTheme();
  const entry = SOURCES[kind];
  if (kind === "azure-devops") return <Icon name="infinity" size={size} color="#0078d4" />;
  if (!entry) return <Icon name="git-pull-request" size={size} color={theme.foreground} />;
  return (
    <svg
      source={entry.source}
      style={{ width: size, height: size, flexShrink: 0, color: entry.color ?? theme.foreground, pointerEvents: "none" }}
    />
  );
}
