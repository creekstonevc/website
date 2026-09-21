import { useCallback, useEffect, useRef, useState } from "react";
import { LiveVoicePlayer, type LiveVoiceState } from "./live-voice-client";

export function useLiveVoice() {
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const [state, setState] = useState<LiveVoiceState>({ phase: "idle" });
  const player = useRef<LiveVoicePlayer | null>(null);
  const toggleEpoch = useRef(0);
  const getPlayer = useCallback(() => player.current ??= new LiveVoicePlayer(setState), []);
  const stop = useCallback(() => player.current?.stop(), []);
  const toggle = useCallback(async () => {
    const epoch = ++toggleEpoch.current;
    if (enabledRef.current) { enabledRef.current = false; setEnabled(false); stop(); return; }
    enabledRef.current = true; setEnabled(true);
    setState({ phase: "preparing" });
    try {
      await getPlayer().enable();
      if (epoch === toggleEpoch.current) setState({ phase: "idle" });
    } catch {
      if (epoch === toggleEpoch.current) { enabledRef.current = false; setEnabled(false);
        setState({ phase: "error", error: "Could not enable audio · tap to retry" }); }
    }
  }, [getPlayer, stop]);
  const start = useCallback(async (key: string) => {
    if (!enabledRef.current) return;
    return getPlayer().start(key);
  }, [getPlayer]);
  useEffect(() => () => { toggleEpoch.current++; void player.current?.dispose(); }, []);
  return { enabled, state, toggle, start, stop };
}
