type ScrollRuntime = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  reducedMotion: () => boolean;
};

export function createTranscriptScroller(node: HTMLElement, onReturnVisible: (value: boolean) => void,
  runtime: ScrollRuntime = {
    requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
    now: () => performance.now(), reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  }) {
  let following = true, frame: number | null = null, previousTop = node.scrollTop;
  let touchY: number | null = null;
  let speech = false, speechElements: HTMLElement[] = [], resumeArmed = false;
  const speechAnchor = () => {
    const rects = speechElements.filter(element => element.isConnected).map(element => element.getBoundingClientRect());
    if (!rects.length) return null;
    const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
    return top + Math.min((bottom - top) / 2, node.clientHeight * 0.2) - node.getBoundingClientRect().top;
  };
  const centered = () => { const anchor = speechAnchor(); return anchor !== null && anchor >= node.clientHeight * 0.35 && anchor <= node.clientHeight * 0.65; };
  const targetTop = () => {
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    if (!speech) return max;
    const anchor = speechAnchor();
    return anchor === null ? node.scrollTop : Math.max(0, Math.min(max, node.scrollTop + anchor - node.clientHeight * 0.5));
  };
  const atBottom = () => node.scrollHeight - node.clientHeight - Math.max(0, node.scrollTop) <= 12;
  // Detachment stops follow immediately; the return control only appears once
  // the reader is more than one transcript viewport away from the bottom.
  const updateReturnControl = () => onReturnVisible(!following && node.clientHeight > 0 &&
    node.scrollHeight - node.clientHeight - Math.max(0, node.scrollTop) > node.clientHeight);
  const stop = () => { if (frame !== null) runtime.cancelFrame(frame); frame = null; };
  const pause = () => {
    following = false; stop();
    if (speech) resumeArmed = !centered();
    updateReturnControl();
  };
  const animate = () => {
    if (!following || frame !== null) return;
    if (speech ? Math.abs(node.scrollTop - targetTop()) < 1 : node.scrollTop === targetTop()) return;
    let lastTime = runtime.now();
    const tick = (time: number) => {
      frame = null;
      if (!following) return;
      const target = targetTop();
      const distance = target - node.scrollTop;
      const reduced = runtime.reducedMotion();
      const step = 1 - Math.exp(-Math.min(time - lastTime, 64) / 70);
      node.scrollTop = reduced || Math.abs(distance) <= 2 ? target : node.scrollTop + distance * step;
      previousTop = node.scrollTop; lastTime = time;
      if (!reduced && Math.abs(target - node.scrollTop) > 1) frame = runtime.requestFrame(tick);
    };
    frame = runtime.requestFrame(tick);
  };
  const follow = () => { following = true; updateReturnControl(); animate(); };
  const onScroll = () => {
    const down = node.scrollTop > previousTop;
    if (speech) {
      const external = Math.abs(node.scrollTop - previousTop) > 1;
      if (external && following) pause();
      previousTop = node.scrollTop;
      if (external && !following) {
        // Leave the central band before re-entry can reattach. A small initial
        // gesture inside the band must not immediately pull the reader back.
        if (!centered()) resumeArmed = true;
        else if (resumeArmed) follow();
      }
      updateReturnControl();
      return;
    }
    // Our animation records its own position; upward movement is external.
    if (node.scrollTop < previousTop - 1) pause();
    previousTop = node.scrollTop;
    if (atBottom() && (down || following || node.scrollHeight <= node.clientHeight)) follow();
    else updateReturnControl();
  };
  const intent = (direction: number) => {
    if (!direction) return;
    if (speech) {
      const canMove = direction < 0 ? node.scrollTop > 0 : !atBottom();
      if (following && canMove && node.scrollHeight > node.clientHeight) pause();
      return;
    }
    if (direction > 0 && atBottom()) follow();
    else if (node.scrollHeight > node.clientHeight) pause();
  };
  const onWheel = (event: WheelEvent) => intent(event.deltaY);
  const onPointer = () => { if (!speech && !atBottom()) pause(); };
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
    setSpeech: (active: boolean) => {
      if (speech === active) return;
      speech = active; speechElements = []; stop();
      previousTop = node.scrollTop;
      if (active) { following = true; resumeArmed = false; }
      updateReturnControl();
    },
    setSpeechTarget: (elements: HTMLElement[]) => {
      if (!speech) return;
      speechElements = elements;
      if (following) animate();
      else if (!centered()) resumeArmed = true;
      updateReturnControl();
      // A new subtitle or LLM delta is not manual re-entry into the center band.
    },
    resize: () => {
      if (following) animate();
      else if (!speech && atBottom()) follow();
      updateReturnControl();
    },
    destroy: () => {
      stop();
      node.removeEventListener("scroll", onScroll); node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onPointer); node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove); node.removeEventListener("keydown", onKey);
    },
  };
}
