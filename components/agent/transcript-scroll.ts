type ScrollRuntime = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  reducedMotion: () => boolean;
};

export function createTranscriptScroller(node: HTMLElement, onDetached: (value: boolean) => void,
  runtime: ScrollRuntime = {
    requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
    now: () => performance.now(), reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  }) {
  let following = true, frame: number | null = null, previousTop = node.scrollTop;
  let touchY: number | null = null;
  const atBottom = () => node.scrollHeight - node.clientHeight - Math.max(0, node.scrollTop) <= 12;
  const stop = () => { if (frame !== null) runtime.cancelFrame(frame); frame = null; };
  const pause = () => {
    following = false; stop();
    // Intent alone is not a reason to display the return control.
    onDetached(!atBottom());
  };
  const animate = () => {
    if (!following || frame !== null) return;
    if (node.scrollTop === Math.max(0, node.scrollHeight - node.clientHeight)) return;
    let lastTime = runtime.now();
    const tick = (time: number) => {
      frame = null;
      if (!following) return;
      const target = Math.max(0, node.scrollHeight - node.clientHeight);
      const distance = target - node.scrollTop;
      const reduced = runtime.reducedMotion();
      const step = 1 - Math.exp(-Math.min(time - lastTime, 64) / 70);
      node.scrollTop = reduced || Math.abs(distance) <= 2 ? target : node.scrollTop + distance * step;
      previousTop = node.scrollTop; lastTime = time;
      if (!reduced && Math.abs(target - node.scrollTop) > 1) frame = runtime.requestFrame(tick);
    };
    frame = runtime.requestFrame(tick);
  };
  const follow = () => { following = true; onDetached(false); animate(); };
  const onScroll = () => {
    const down = node.scrollTop > previousTop;
    // Our animation records its own position; upward movement is external.
    if (node.scrollTop < previousTop - 1) pause();
    previousTop = node.scrollTop;
    if (atBottom() && (down || following || node.scrollHeight <= node.clientHeight)) follow();
    else onDetached(!following && !atBottom());
  };
  const intent = (direction: number) => {
    if (!direction) return;
    if (direction > 0 && atBottom()) follow();
    else if (node.scrollHeight > node.clientHeight) pause();
  };
  const onWheel = (event: WheelEvent) => intent(event.deltaY);
  const onPointer = () => { if (!atBottom()) pause(); };
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; };
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (touchY !== null && y !== undefined) intent(touchY - y);
    touchY = y ?? null;
  };
  const onKey = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
    if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) intent(-1);
    else if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) intent(1);
  };
  node.addEventListener("scroll", onScroll, { passive: true });
  node.addEventListener("wheel", onWheel, { passive: true });
  node.addEventListener("pointerdown", onPointer, { passive: true });
  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: true });
  node.addEventListener("keydown", onKey);
  return {
    pause, follow,
    resize: () => {
      if (following) animate();
      else if (atBottom()) follow();
      else onDetached(true);
    },
    destroy: () => {
      stop();
      node.removeEventListener("scroll", onScroll); node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onPointer); node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove); node.removeEventListener("keydown", onKey);
    },
  };
}
