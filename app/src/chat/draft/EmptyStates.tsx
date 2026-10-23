// Ports of apps/web/src/components/NoProjectsHero.tsx and NoActiveThreadState.tsx
// (ui/empty.tsx: centered column; title semibold 20 (hero 30); description 14 muted, mt 4).
import { openCommandPalette } from "../../state/palette.ts";
import { scratchEnvironmentId, startScratchThread } from "../../palette/actions.ts";
import { Button, Text } from "../../ui/primitives.tsx";
import { useTheme } from "../../ui/theme.ts";
import { MainHeader } from "../../app/MainView.tsx";

function EmptyHeader({
  title,
  description,
  hero,
  children,
}: {
  title: string;
  description: string;
  hero?: boolean;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 48 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 512, paddingLeft: 32, paddingRight: 32, paddingTop: 48, paddingBottom: 48 }}>
        <Text size={hero ? "3xl" : "xl"} weight={600} style={{ textAlign: "center" }}>
          {title}
        </Text>
        <Text color={theme.mutedForeground} style={{ marginTop: 4, textAlign: "center" }}>
          {description}
        </Text>
        {children}
      </div>
    </div>
  );
}

export function NoProjectsHero({ primaryEnvironmentId }: { primaryEnvironmentId: Parameters<typeof scratchEnvironmentId>[0] }) {
  const scratchTarget = scratchEnvironmentId(primaryEnvironmentId);
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <EmptyHeader
        hero
        title="What should we work on?"
        description={scratchTarget === null ? "Add a project to start your first thread." : "Add a project, or start without one."}
      >
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 24 }}>
          <Button size="sm" icon="plus" testId="no-projects-add-project" onClick={() => openCommandPalette({ open: "add-project" })}>
            Add project
          </Button>
          {scratchTarget === null ? null : (
            <Button size="sm" variant="outline" icon="message-square-dashed" testId="no-projects-start-scratch" onClick={() => void startScratchThread(scratchTarget)}>
              Start without a project
            </Button>
          )}
        </div>
      </EmptyHeader>
    </div>
  );
}

export function NoActiveThreadState() {
  const theme = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0 }}>
      <div style={{ borderBottomWidth: 1, borderColor: theme.border }}>
        <MainHeader
          crumbs={
            <Text weight={500} color={theme.mutedForeground} style={{ opacity: 0.6 }}>
              No active thread
            </Text>
          }
        />
      </div>
      <EmptyHeader title="Pick a thread to continue" description="Select an existing thread or create a new one to get started." />
    </div>
  );
}
