// Port of apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx: the active
// question, its options, collapse and dismiss. The custom answer is typed into the
// composer editor; Previous / Submit live in the composer's primary actions.
//
// The 1-9 option shortcuts reach the card through handlePendingQuestionDigit, which the
// composer calls for a digit that has no editor to go to (web's document keydown handler).
// A long question scrolls inside the card at web's ComposerBanner.Scroll height.
import type { ThreadPendingUserInput } from "@t3tools/client-runtime/state/thread-requests";
import type { RuntimeRequestId } from "@t3tools/contracts";
import { memo, useEffect, useRef, useState } from "react";

import { Icon } from "../../ui/Icon.tsx";
import { FONTS, RADIUS, alpha, useTheme } from "../../ui/theme.ts";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../web/pendingUserInput.ts";
import {
  BannerActions,
  BannerContent,
  BannerIcon,
  BannerIconButton,
  BannerRow,
  BannerText,
  BannerToggleIcon,
} from "./ComposerBannerParts.tsx";

/** The open question's option picker, while it takes picks. */
let digitShortcut: ((digit: number) => boolean) | null = null;

/** web 1-9 shortcut: picks the nth option of the open question. True when it did. */
export function handlePendingQuestionDigit(digit: number): boolean {
  return digitShortcut?.(digit) ?? false;
}

interface PendingUserInputPanelProps {
  readonly pendingUserInputs: ReadonlyArray<ThreadPendingUserInput>;
  readonly disabled?: boolean;
  readonly respondingRequestIds: ReadonlyArray<RuntimeRequestId>;
  readonly answers: Record<string, PendingUserInputDraftAnswer>;
  readonly questionIndex: number;
  readonly onToggleOption: (questionId: string, optionValue: string) => void;
  readonly onAdvance: () => void;
  readonly onDismiss: (requestId: RuntimeRequestId) => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  disabled = false,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: PendingUserInputPanelProps) {
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;
  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      disabled={disabled}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
}: {
  prompt: ThreadPendingUserInput;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
}) {
  const theme = useTheme();
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The auto-advance timer fires after the render that armed it.
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;

  // The optimistic pick is dropped once the draft confirms it or the question moves on.
  if (
    optimisticSingleSelect &&
    activeQuestion &&
    !activeQuestion.multiSelect &&
    (optimisticSingleSelect.questionId !== activeQuestion.id ||
      (!customAnswerActive && progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)))
  ) {
    setOptimisticSingleSelect(null);
  }

  // A delayed answer only advances its own question, while permission remains granted.
  useEffect(() => {
    const clearAutoAdvance = () => {
      if (autoAdvanceTimerRef.current !== null) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearAutoAdvance();
    return clearAutoAdvance;
  }, [activeQuestion?.id, disabled]);

  const handleOptionSelection = (questionId: string, optionValue: string) => {
    if (!activeQuestion) return;
    if (disabled || isResponding) return;
    if (activeQuestion.multiSelect) {
      onToggleOption(questionId, optionValue);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionValue });
    onToggleOption(questionId, optionValue);
    if (autoAdvanceTimerRef.current !== null) clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceTimerRef.current = setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advanceRef.current();
    }, 200);
  };
  const selectByDigitRef = useRef<(digit: number) => boolean>(() => false);
  selectByDigitRef.current = (digit) => {
    if (!activeQuestion || disabled || isResponding || isCollapsed) return false;
    const option = activeQuestion.options[digit - 1];
    if (!option) return false;
    handleOptionSelection(activeQuestion.id, option.value ?? option.label);
    return true;
  };
  useEffect(() => {
    const handler = (digit: number) => selectByDigitRef.current(digit);
    digitShortcut = handler;
    return () => {
      if (digitShortcut === handler) digitShortcut = null;
    };
  }, []);

  if (!activeQuestion) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <BannerRow
        testId="user-input-toggle"
        onClick={() => setCollapsedQuestionId(isCollapsed ? null : activeQuestion.id)}
      >
        <BannerIcon />
        <BannerContent>
          <BannerText weight={500} color={theme.mutedForeground}>
            {activeQuestion.header}
          </BannerText>
          {isCollapsed ? (
            <BannerText truncate grow color={theme.mutedForeground}>
              {activeQuestion.question.replace(/\s+/g, " ")}
            </BannerText>
          ) : null}
        </BannerContent>
        <BannerActions>
          {prompt.questions.length > 1 ? (
            <BannerText size="3xs" weight={500} color={theme.mutedForeground}>
              {`${questionIndex + 1}/${prompt.questions.length}`}
            </BannerText>
          ) : null}
          <BannerToggleIcon expanded={!isCollapsed} />
          {prompt.dismissible ? (
            <BannerIconButton
              icon="x"
              testId="user-input-dismiss"
              disabled={isResponding}
              onClick={() => onDismiss(prompt.requestId)}
            />
          ) : null}
        </BannerActions>
      </BannerRow>
      {isCollapsed ? null : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxHeight: 360,
            overflowY: "scroll",
            scrollbarWidth: 6,
            scrollbarColor: theme.scrollbar,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              paddingLeft: 28,
              paddingRight: 4,
              paddingBottom: 4,
              flexShrink: 0,
            }}
          >
            <markdown
              testId="user-input-question"
              source={activeQuestion.question}
              theme={{
                appearance: theme.appearance,
                text: alpha(theme.foreground, 0.85),
                bg: theme.background,
                accent: theme.infoForeground,
                fontSans: FONTS.sans,
                fontMono: FONTS.mono,
                metrics: { mdTextSize: 14, mdLineHeight: 23, mdBlockGap: 10, mdHeadingSizes: [20, 18, 16, 14] },
              }}
            />
            {activeQuestion.multiSelect ? (
              <BannerText color={theme.mutedForeground} style={{ marginTop: 4 }}>
                Select one or more options.
              </BannerText>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
              {activeQuestion.options.map((option, index) => {
                const optionValue = option.value ?? option.label;
                const isOptimisticallySelected =
                  optimisticSingleSelect?.questionId === activeQuestion.id &&
                  optimisticSingleSelect.optionValue === optionValue;
                const isSelected =
                  isOptimisticallySelected ||
                  (!customAnswerActive && progress.selectedOptionValues.includes(optionValue));
                return (
                  <OptionRow
                    key={`${activeQuestion.id}:${optionValue}`}
                    testId={`user-input-option-${index + 1}`}
                    label={option.label}
                    description={
                      option.description && option.description !== option.label ? option.description : null
                    }
                    selected={isSelected}
                    shortcutKey={index < 9 ? index + 1 : null}
                    disabled={disabled || isResponding}
                    onSelect={() => handleOptionSelection(activeQuestion.id, optionValue)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function OptionRow({
  label,
  description,
  selected,
  shortcutKey,
  disabled,
  onSelect,
  testId,
}: {
  label: string;
  description: string | null;
  selected: boolean;
  shortcutKey: number | null;
  disabled: boolean;
  onSelect: () => void;
  testId: string;
}) {
  const theme = useTheme();
  // bg-muted/55 selected, hover:bg-muted/30; muted is white 3% in dark.
  const mutedFill = theme.appearance === "dark" ? "#ffffff08" : theme.muted;
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onSelect}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: RADIUS.sm,
        backgroundColor: selected ? alpha(mutedFill, 0.55) : "#00000000",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
        flexShrink: 0,
        ...(disabled || selected ? {} : { hover: { backgroundColor: alpha(mutedFill, 0.3) } }),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0, pointerEvents: "none" }}>
        <BannerText size="sm" weight={500} color={selected ? theme.foreground : alpha(theme.foreground, 0.85)}>
          {label}
        </BannerText>
        {description ? (
          <BannerText size="2xs" color={theme.mutedForeground}>
            {description}
          </BannerText>
        ) : null}
      </div>
      {selected ? (
        <Icon name="check" size={14} color={theme.primary} />
      ) : shortcutKey !== null ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            flexShrink: 0,
            pointerEvents: "none",
          }}
        >
          <BannerText size="3xs" weight={500} color={theme.mutedForeground}>
            {String(shortcutKey)}
          </BannerText>
        </div>
      ) : null}
    </div>
  );
}
