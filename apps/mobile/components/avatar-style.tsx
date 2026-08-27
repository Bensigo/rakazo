import type { AvatarStyle, Me } from "@rakazo/contracts";
import { usePathname } from "expo-router";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { rpc } from "../lib/api";

const AvatarStyleContext = createContext<{
  avatarStyle: AvatarStyle;
  updateAvatarStyle: (avatarStyle: AvatarStyle) => Promise<void>;
}>({
  avatarStyle: "robot",
  updateAvatarStyle: async () => undefined,
});

export function AvatarStyleProvider({ children }: { children: ReactNode }) {
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>("robot");
  const pathname = usePathname();

  useEffect(() => {
    void rpc<Me>("me")
      .then((me) => setAvatarStyle(me.avatarStyle))
      .catch(() => undefined);
  }, [pathname]);

  async function updateAvatarStyle(next: AvatarStyle) {
    const me = await rpc<Me>("preferences/update", { avatarStyle: next });
    setAvatarStyle(me.avatarStyle);
  }

  return (
    <AvatarStyleContext value={{ avatarStyle, updateAvatarStyle }}>{children}</AvatarStyleContext>
  );
}

export function useAvatarStyle() {
  return useContext(AvatarStyleContext);
}
