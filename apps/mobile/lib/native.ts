import { type ColorValue, Platform, PlatformColor } from "react-native";
import { mobileTokens, resolveMobileAppearance } from "./appearance";

function systemColor(iosName: string, lightFallback: string, darkFallback: string): ColorValue {
  if (Platform.OS === "ios") return PlatformColor(iosName);
  return resolveMobileAppearance() === "light" ? lightFallback : darkFallback;
}

/** Theme-aware native colors backed by shared tokens + iOS platform colors. */
export const native = {
  get page() {
    return mobileTokens().page;
  },
  get fill() {
    return systemColor("tertiarySystemFill", mobileTokens().surface2, "#1C1C1E");
  },
  get fillPressed() {
    return systemColor("secondarySystemFill", mobileTokens().elevated, "#2C2C2E");
  },
  get label() {
    return systemColor("label", mobileTokens().ink, "#FFFFFF");
  },
  get secondaryLabel() {
    return systemColor("secondaryLabel", mobileTokens().muted, "#8E8E93");
  },
  get tertiaryLabel() {
    return systemColor("tertiaryLabel", mobileTokens().muted2, "#6C6C70");
  },
} as const;
