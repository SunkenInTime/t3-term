// Stand-in for apps/web/src/components/settings/ThemeImportDialog.tsx. The
// theme editor (ThemeEditorPanel.tsx) saves custom themes, but importing T3
// Code or VS Code theme files (file picker, VS Code extension packages,
// collections) is not ported, so "Add theme" opens this dialog so the click
// explains itself instead of doing nothing.
import { Dialog } from "../../ui/overlay.tsx";
import { Button, Text } from "../../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../../ui/theme.ts";

export function CustomThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add a theme"
      description="Importing theme files is not available in t3-term yet."
      testId="custom-theme-dialog"
      footer={
        <Button variant="outline" size="sm" onClick={onClose} testId="custom-theme-dialog-close">
          Close
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Text color={theme.mutedForeground}>
          T3 Code and VS Code theme files cannot be read in t3-term yet. Themes you make with Create theme are saved
          and show up in the Themes grid.
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
            Use Create theme to start from the active theme, or the copy button on any card to start from that one.
          </Text>
        </div>
      </div>
    </Dialog>
  );
}
