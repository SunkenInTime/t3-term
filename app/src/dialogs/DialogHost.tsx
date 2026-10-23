// OWNER: palette/navigation agent. Mount point for app-level dialogs. Each dialog
// module exports an opener (openX / requestX) that other areas call.
import { AddProjectToMachineDialogHost } from "./AddProjectToMachineDialog.tsx";
import { ConfirmDialogHost } from "./ConfirmDialogHost.tsx";
import { CustomSnoozeDialogHost } from "./CustomSnoozeDialog.tsx";
import { LinkPullRequestDialogHost } from "./LinkPullRequestDialog.tsx";
import { PullRequestThreadDialogHost } from "./PullRequestThreadDialog.tsx";

export function DialogHost() {
  return (
    <>
      <ConfirmDialogHost />
      <CustomSnoozeDialogHost />
      <LinkPullRequestDialogHost />
      <PullRequestThreadDialogHost />
      <AddProjectToMachineDialogHost />
    </>
  );
}
