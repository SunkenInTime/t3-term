// Port of apps/web/src/components/pullRequest/PullRequestMarkdownEditor.tsx: Write/Preview over a
// textarea, Cancel and Save, Ctrl/Cmd+Enter saves and Escape cancels. Used for the description,
// comments and review-thread remarks.
import { AuthSourceControlWriteScope, type EnvironmentId } from "@t3tools/contracts";
import type { EventPayload } from "@gpuix/native";
import { useState } from "react";

import { Text } from "../ui/primitives.tsx";
import { RADIUS, alpha, useTheme } from "../ui/theme.ts";
import { readEnvironmentScope, useEnvironmentScope } from "../web/state/session.ts";
import { PrButton, PrSegmented, PrTextarea } from "./prControls.tsx";
import { PrMarkdown } from "./PullRequestSummaryTab.tsx";

export function isCommentSubmitChord(event: EventPayload): boolean {
  const modifiers = (event.modifiers ?? {}) as { ctrl?: boolean; cmd?: boolean; shift?: boolean; alt?: boolean };
  return event.key === "enter" && (modifiers.ctrl === true || modifiers.cmd === true) && !modifiers.shift && !modifiers.alt;
}

export function PullRequestMarkdownEditor({
  value,
  environmentId,
  placeholder,
  saving,
  allowEmpty = false,
  onSave,
  onCancel,
  testId = "pr-markdown-editor",
}: {
  readonly value: string;
  readonly environmentId: EnvironmentId;
  readonly placeholder?: string | undefined;
  readonly saving: boolean;
  readonly allowEmpty?: boolean;
  readonly onSave: (next: string) => void;
  readonly onCancel: () => void;
  readonly testId?: string;
}) {
  const theme = useTheme();
  const canWriteSourceControl = useEnvironmentScope(environmentId, AuthSourceControlWriteScope);
  const [draft, setDraft] = useState(value);
  const [preview, setPreview] = useState(false);
  // An editor reused for another remark must not save the first remark's text onto the second.
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  const empty = draft.trim().length === 0;
  const saveDisabled = !canWriteSourceControl || saving || (empty && !allowEmpty);
  const save = () => {
    if (saveDisabled || !readEnvironmentScope(environmentId, AuthSourceControlWriteScope)) return;
    onSave(draft);
  };
  return (
    <div
      testId={testId}
      onKeyDown={(event) => {
        if (isCommentSubmitChord(event)) {
          save();
          return;
        }
        if (event.key === "escape" && !saving) onCancel();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flexGrow: 1 }}
    >
      <PrSegmented
        value={preview ? "preview" : "write"}
        disabled={saving}
        testIdPrefix={`${testId}-mode`}
        options={[
          { value: "write", label: "Write" },
          { value: "preview", label: "Preview" },
        ]}
        onChange={(mode) => setPreview(mode === "preview")}
      />
      {preview ? (
        <div
          style={{
            display: "flex",
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 8,
            paddingBottom: 8,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: alpha(theme.border, 0.6),
          }}
        >
          {empty ? (
            <Text size="xs" color={theme.mutedForeground}>
              Nothing to preview.
            </Text>
          ) : (
            <PrMarkdown source={draft} />
          )}
        </div>
      ) : (
        <PrTextarea
          autoFocus
          disabled={saving}
          value={draft}
          minRows={6}
          maxRows={16}
          placeholder={placeholder}
          testId={`${testId}-input`}
          onChange={setDraft}
        />
      )}
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <PrButton variant="ghost" disabled={saving} onClick={onCancel} testId={`${testId}-cancel`}>
          Cancel
        </PrButton>
        <PrButton variant="outline" disabled={saveDisabled} onClick={save} testId={`${testId}-save`}>
          {saving ? "Saving..." : "Save"}
        </PrButton>
      </div>
    </div>
  );
}
