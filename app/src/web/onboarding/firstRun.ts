// Ported from vendor/t3code/apps/web/src/onboarding/firstRun.ts; t3-term's client
// settings live in state/clientSettings.ts.
import { ensureClientSettingsHydrated, persistClientSettingsPatch } from "../../state/clientSettings.ts";

export async function completeOnboarding(): Promise<void> {
  await ensureClientSettingsHydrated();
  const onboardingCompletedAt = new Date().toISOString();
  await persistClientSettingsPatch({ onboardingCompletedAt });
}
