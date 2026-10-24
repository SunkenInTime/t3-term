// CodexArtifactTemplateCard from apps/web/src/components/ChatMarkdown.tsx: a
// Codex `::artifact-template{...}` directive renders as a card with the
// template's kind icon, its name and kind label, and "Use template", which
// appends the template's prompt to the thread's composer.
import {
  codexArtifactTemplatePresentationLabel,
  type CodexArtifactTemplate,
  type CodexArtifactTemplateKind,
} from "@t3tools/shared/codexArtifactTemplates";

import { Icon, type IconName } from "../../ui/Icon.tsx";
import { Button } from "../../ui/primitives.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";

const ICON_BY_KIND = {
  document: "file-text",
  presentation: "presentation",
  spreadsheet: "file-spreadsheet",
  site: "globe",
  "google-docs": "file-text",
  "google-slides": "presentation",
  "google-sheets": "file-spreadsheet",
  image: "image",
  email: "mail",
  slack: "message-square",
} satisfies Record<CodexArtifactTemplateKind, IconName>;

export function ArtifactTemplateCard({
  template,
  onUse,
}: {
  template: CodexArtifactTemplate;
  onUse: ((template: CodexArtifactTemplate) => void) | undefined;
}) {
  const theme = useTheme();
  const shadowXs = { offsetX: 0, offsetY: 1, blurRadius: 1, spreadRadius: 0, color: "#0000000d" };
  return (
    // my-[0.65rem] flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 shadow-xs
    <div
      testId="artifact-template-card"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minWidth: 0,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: alpha(theme.border, 0.7),
        backgroundColor: alpha(theme.card, 0.6),
        boxShadow: shadowXs,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.7),
            backgroundColor: theme.background,
            boxShadow: shadowXs,
          }}
        >
          <Icon name={ICON_BY_KIND[template.artifactKind]} size={20} color={theme.mutedForeground} />
          {/* absolute -right-1 -bottom-1 size-4 rounded-full border-background bg-primary */}
          <div
            style={{
              position: "absolute",
              right: -4,
              bottom: -4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.background,
              backgroundColor: theme.primary,
              pointerEvents: "none",
            }}
          >
            <Icon name="sparkles" size={10} color={theme.primaryForeground} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1, flexBasis: 0 }}>
          <text style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 20, fontWeight: 500, color: theme.foreground, whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {template.displayName}
          </text>
          <text style={{ fontFamily: FONTS.sans, fontSize: 12, lineHeight: 16, color: theme.mutedForeground }}>
            {codexArtifactTemplatePresentationLabel(template.artifactKind)}
          </text>
        </div>
      </div>
      {onUse ? (
        <Button variant="outline" size="sm" testId="artifact-template-use" style={{ flexShrink: 0 }} onClick={() => onUse(template)}>
          Use template
        </Button>
      ) : null}
    </div>
  );
}
