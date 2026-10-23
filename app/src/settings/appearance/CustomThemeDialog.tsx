// Stand-in for apps/web/src/components/settings/{ThemeEditorPanel,
// ThemeImportDialog}.tsx. Both write custom themes the app must then be able
// to paint, and t3-term's palette resolution (state/clientSettings.ts:
// sanitizeTheme, resolveActiveThemeId, resolvePalette) only knows the
// built-in themes. Until that lands, the buttons open this dialog so the
// click explains itself instead of doing nothing.
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, getThemeDefinition, useTheme } from "../../ui/theme.ts";

export type CustomThemeDialogRequest =
  | { readonly kind: "create"; readonly seedThemeId: string | null; readonly seedName: string | null }
  | { readonly kind: "add" };

export function CustomThemeDialog({ request, onClose }: { request: CustomThemeDialogRequest | null; onClose: () => void }) {
  const theme = useTheme();
  const isCreate = request?.kind === "create";
  const seedLabel =
    request?.kind === "create"
      ? (request.seedName ?? `${(request.seedThemeId ? getThemeDefinition(request.seedThemeId)?.label : null) ?? "T3 Code"} copy`)
      : null;
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={isCreate ? "Create theme" : "Add a theme"}
      description={
        isCreate
          ? "The theme editor is not available in t3-term yet."
          : "Importing theme files is not available in t3-term yet."
      }
      testId="custom-theme-dialog"
      footer={
        <Button variant="outline" size="sm" onClick={onClose} testId="custom-theme-dialog-close">
          Close
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Text color={theme.mutedForeground}>
          {isCreate
            ? `A new theme would start from ${seedLabel ?? "the active theme"}. t3-term can paint the built-in themes, but it cannot store or apply custom ones yet, so an edited theme would have nowhere to go.`
            : "T3 Code and VS Code theme files need somewhere to live and a way to repaint the app. t3-term only resolves its built-in themes today."}
        </Text>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            paddingTop: 10,
            paddingBottom: 10,
            paddingLeft: 12,
            paddingRight: 12,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.7),
            backgroundColor: alpha(theme.muted, 0.2),
          }}
        >
          <Text size="xs" weight={500}>
            Meanwhile
          </Text>
          <Text size="xs" color={theme.mutedForeground} style={{ lineHeight: 18 }}>
            Pick any built-in theme for light, dark, or both from the Themes grid. Each circle sets one appearance.
          </Text>
        </div>
      </div>
    </Dialog>
  );
}
