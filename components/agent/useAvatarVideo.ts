import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AvatarConnection, type VideoState } from "./video-client";

export function useAvatarVideo(enabled: boolean, sessionKey: string, element: RefObject<HTMLVideoElement | null>) {
  const connection = useRef<AvatarConnection | null>(null);
  const [state, setState] = useState<VideoState>({ phase: "idle", message: "Text input · live video output" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !sessionKey || !element.current) return;
    const client = new AvatarConnection(sessionKey, element.current, setState);
    connection.current = client;
    void client.connect();
    const leave = () => client.close();
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); client.close(); connection.current = null; };
  }, [enabled, sessionKey, attempt, element]);
  return { state, reconnect: () => setAttempt(value => value + 1),
    play: () => void connection.current?.play(),
    startReply: useCallback((ticket?: string) => connection.current?.startReply(ticket) ?? Promise.resolve(undefined), []),
    close: useCallback(() => {
      connection.current?.close();
      setState({ phase: "error", message: "Video stopped. Reconnect to continue; text chat is still open." });
    }, []) };
}
