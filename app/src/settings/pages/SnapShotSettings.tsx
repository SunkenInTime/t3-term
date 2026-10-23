// Port of apps/web/src/components/settings/SnapShotSettings.tsx. SnapShots
// capture other windows through the desktop app's bridge; t3-term has no such
// bridge, so the page renders the way the hosted web app does: the row behind
// "Only available in the desktop app." with its switch disabled.
import { useClientSettings } from "../../state/clientSettings.ts";
import { Switch } from "../../ui/overlay.tsx";
import { searchableSetting } from "../../web/components/settings/settingsSearch.ts";
import { SettingsPageContainer, SettingsRow, SettingsSection, SettingsUnavailableGroup } from "../layout.tsx";

/** SnapShotSettings.logic.ts snapShotUnavailableMessage(false) outside Electron. */
const UNAVAILABLE_MESSAGE = "Only available in the desktop app.";

export function SnapShotSettings() {
  const enabled = useClientSettings((settings) => settings.snapShotEnabled);
  return (
    <SettingsPageContainer showScope={false}>
      <SettingsSection id="snap-shot" title="SnapShots">
        <SettingsUnavailableGroup message={UNAVAILABLE_MESSAGE}>
          <SettingsRow
            {...searchableSetting("snap-shot-enabled")}
            description="Capture a window and attach it to your current draft."
            control={<Switch checked={enabled} disabled onChange={() => {}} testId="settings-snap-shot-enabled" />}
          />
        </SettingsUnavailableGroup>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
