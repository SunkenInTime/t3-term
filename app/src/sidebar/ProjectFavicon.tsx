// apps/web/src/components/ProjectFavicon.tsx + ProjectMonogram.tsx.
// The favicon URL comes from the server's asset endpoint (a signed URL, so
// gpuix's <img> loads it without auth headers). Without one, the project's
// icon override or a monogram derived from its title stands in.
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import type { ProjectIconColor } from "@t3tools/contracts";

import { projectFaviconUrlAtom } from "../state/sidebar.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { LUCIDE } from "../ui/lucide.gen.ts";
import { FONTS, alpha, useTheme } from "../ui/theme.ts";
import { deriveProjectIdentity } from "../web/projectIdentity.ts";

export type ProjectFaviconProject = Pick<
  EnvironmentProject,
  "environmentId" | "workspaceRoot" | "title" | "faviconPath" | "projectIcon"
>;

/** Tailwind v4 `-400` shades: the dark-mode `projectIconColorClassName` tones. */
const PROJECT_ICON_COLOR_HEX: Record<ProjectIconColor, string> = {
  gray: "#99a1af",
  red: "#ff6467",
  orange: "#ff8904",
  amber: "#ffb900",
  yellow: "#fdc700",
  lime: "#9ae600",
  green: "#05df72",
  emerald: "#00d492",
  teal: "#00d5be",
  cyan: "#00d3f2",
  sky: "#00bcff",
  blue: "#51a2ff",
  indigo: "#7c86ff",
  violet: "#a684ff",
  purple: "#c27aff",
  fuchsia: "#ed6aff",
  pink: "#fb64b6",
  rose: "#ff637e",
};

export function projectIconColorHex(color: ProjectIconColor): string {
  return PROJECT_ICON_COLOR_HEX[color] ?? PROJECT_ICON_COLOR_HEX.blue;
}

/** CSS `grayscale(1)`: the colour's Rec. 709 luminance as a grey. */
function grayscaleHex(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    .toString(16)
    .padStart(2, "0");
  return `#${y}${y}${y}`;
}

export function ProjectMonogram({
  text,
  color,
  size = 16,
  grayscale = false,
}: {
  readonly text: string;
  readonly color: ProjectIconColor;
  readonly size?: number;
  readonly grayscale?: boolean;
}) {
  const hex = grayscale ? grayscaleHex(projectIconColorHex(color)) : projectIconColorHex(color);
  // Web draws the letters with textLength squeezed to 12/16 of the tile; a
  // bold mono face at ~0.5 of the tile lands on the same width.
  const glyphs = Array.from(text).length;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 4,
        backgroundColor: alpha(hex, 0.14),
        flexShrink: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <text
        style={{
          color: hex,
          fontSize: Math.round(size * (glyphs === 1 ? 0.56 : 0.5) * 10) / 10,
          fontWeight: 700,
          fontFamily: FONTS.mono,
          lineHeight: size,
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </text>
    </div>
  );
}

function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(LUCIDE, name);
}

export function ProjectFavicon({
  project,
  size = 16,
  opacity,
  grayscale = false,
}: {
  project: ProjectFaviconProject;
  size?: number;
  opacity?: number;
  /**
   * Web's receded rows use `grayscale`. gpuix has no image filters, so a
   * server favicon keeps its colours; generated icons turn grey.
   */
  grayscale?: boolean;
}) {
  const theme = useTheme();
  const src = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: project.environmentId,
      cwd: project.workspaceRoot,
      faviconPath: project.faviconPath,
    }),
  );
  const wrap = (child: React.ReactNode) =>
    opacity === undefined ? (
      child
    ) : (
      <div style={{ display: "flex", flexShrink: 0, opacity, pointerEvents: "none" }}>{child}</div>
    );

  const icon = project.projectIcon;
  if (icon?.kind === "monogram") {
    return wrap(<ProjectMonogram text={icon.text} color={icon.color} size={size} grayscale={grayscale} />);
  }
  if (icon?.kind === "emoji") {
    return wrap(
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          flexShrink: 0,
        }}
      >
        <text style={{ color: theme.foreground, fontSize: size * 0.8, lineHeight: size }}>
          {icon.emoji}
        </text>
      </div>,
    );
  }
  if (icon?.kind === "lucide") {
    const name = isIconName(icon.name) ? icon.name : "folder-code";
    const hex = projectIconColorHex(icon.color);
    return wrap(<Icon name={name} size={size} color={grayscale ? grayscaleHex(hex) : hex} />);
  }
  if (!src || isProjectFaviconFallbackUrl(src)) {
    if (project.title.trim().length > 0) {
      const identity = deriveProjectIdentity(project.title);
      return wrap(
        <ProjectMonogram text={identity.monogram} color={identity.color} size={size} grayscale={grayscale} />,
      );
    }
    return wrap(<Icon name="folder-code" size={size} color={theme.mutedForeground} />);
  }
  return wrap(
    <img
      src={src}
      objectFit="contain"
      style={{ width: size, height: size, borderRadius: size / 4, flexShrink: 0, pointerEvents: "none" }}
    />,
  );
}
