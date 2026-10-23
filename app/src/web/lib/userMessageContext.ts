// Subset of apps/web/src/lib/composerContextRecords.ts: the two helpers the
// timeline's user message row reads. The full module pulls in composer draft
// state, which belongs to the composer area.
import type {
  ComposerContextRecord,
  KnownComposerContextRecord,
  OrchestrationMessageContext,
} from "@t3tools/contracts";
import { upgradeLegacyContextMessage } from "@t3tools/shared/composerContextLegacy";

export function asKnownContextRecord(
  record: ComposerContextRecord | undefined,
): KnownComposerContextRecord | undefined {
  if (!record || "payload" in record) return undefined;
  return record as KnownComposerContextRecord;
}

export interface ResolvedUserMessageContext {
  text: string;
  records: ReadonlyArray<ComposerContextRecord>;
  recordsById: ReadonlyMap<string, ComposerContextRecord>;
}

export function resolveUserMessageContext(message: {
  text: string;
  context?: OrchestrationMessageContext | undefined;
}): ResolvedUserMessageContext {
  const resolved = message.context
    ? { text: message.text, records: message.context.records }
    : upgradeLegacyContextMessage(message.text);
  return {
    text: resolved.text,
    records: resolved.records,
    recordsById: new Map(resolved.records.map((record) => [record.contextId, record])),
  };
}
