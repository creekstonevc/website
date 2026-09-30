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
  let speech = false, speechElements: HTMLElement[] = [];
  let resumeFrame: number | null = null, resumeCandidate = false, lastManualAt = 0, pointerHeld = false;
  const gestureTarget = node.ownerDocument ?? node;
  const speechAnchor = () => {
    const rects = speechElements.filter(element => element.isConnected).map(element => element.getBoundingClientRect());
    if (!rects.length) return null;
    const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
    return top + Math.min((bottom - top) / 2, node.clientHeight * 0.2) - node.getBoundingClientRect().top;
  };
  const targetTop = () => {
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    if (!speech) return max;
    const anchor = speechAnchor();
    return anchor === null ? node.scrollTop : Math.max(0, Math.min(max, node.scrollTop + anchor - node.clientHeight * 0.5));
  };
  // Normally the middle 35–65% band. At either edge, use the nearest reachable
  // follow position: the first/last sentence cannot always be scrolled to center.
  const nearSpeech = () => speechAnchor() !== null && node.clientHeight > 0 &&
    Math.abs(node.scrollTop - targetTop()) <= node.clientHeight * 0.15;
  const atBottom = () => node.scrollHeight - node.clientHeight - Math.max(0, node.scrollTop) <= 12;
  // Detachment stops follow immediately; the return control only appears once
  // the reader is more than one transcript viewport away from the bottom.
  const updateReturnControl = () => onReturnVisible(!following && node.clientHeight > 0 &&
    node.scrollHeight - node.clientHeight - Math.max(0, node.scrollTop) > node.clientHeight);
  const stopResume = () => { if (resumeFrame !== null) runtime.cancelFrame(resumeFrame); resumeFrame = null; };
  const stop = () => { if (frame !== null) runtime.cancelFrame(frame); frame = null; };
  const pause = () => {
    following = false; stop(); stopResume(); resumeCandidate = false;
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
  const follow = () => { stopResume(); resumeCandidate = false; following = true; updateReturnControl(); animate(); };
  const scheduleResume = () => {
    stopResume();
    if (!resumeCandidate || pointerHeld || touchY !== null) return;
    const check = () => {
      resumeFrame = null;
      if (!speech || following || !resumeCandidate || !nearSpeech()) { resumeCandidate = false; return; }
      if (runtime.now() - lastManualAt < 180) { resumeFrame = runtime.requestFrame(check); return; }
      follow();
    };
    resumeFrame = runtime.requestFrame(check);
  };
  const onScroll = () => {
    const down = node.scrollTop > previousTop;
    if (speech) {
      const external = Math.abs(node.scrollTop - previousTop) > 0.01;
      if (external && following) pause();
      if (external && !following) {
        const target = targetTop(), before = previousTop - target, after = node.scrollTop - target;
        // Only actual movement BACK toward (or across) the current target may
        // resume. A cue advancing by itself or an initial small scroll away may
        // not. Wait out the gesture's inertial tail before switching to follow.
        resumeCandidate = nearSpeech() && (resumeCandidate || Math.abs(after) < Math.abs(before) || before * after < 0);
        lastManualAt = runtime.now(); scheduleResume();
      }
      previousTop = node.scrollTop;
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
      lastManualAt = runtime.now(); scheduleResume();
      const canMove = direction < 0 ? node.scrollTop > 0 : !atBottom();
      if (following && canMove && node.scrollHeight > node.clientHeight) pause();
      return;
    }
    if (direction > 0 && atBottom()) follow();
    else if (node.scrollHeight > node.clientHeight) pause();
  };
  const onWheel = (event: WheelEvent) => intent(event.deltaY);
  const onPointer = () => { pointerHeld = true; stopResume(); if (!speech && !atBottom()) pause(); };
  const onPointerEnd = () => { pointerHeld = false; lastManualAt = runtime.now(); scheduleResume(); };
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; stopResume(); };
  const onTouchEnd = () => { touchY = null; lastManualAt = runtime.now(); scheduleResume(); };
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
  gestureTarget.addEventListener("pointerup", onPointerEnd, { passive: true });
  gestureTarget.addEventListener("pointercancel", onPointerEnd, { passive: true });
  gestureTarget.addEventListener("touchend", onTouchEnd, { passive: true });
  gestureTarget.addEventListener("touchcancel", onTouchEnd, { passive: true });
  return {
    pause, follow,
    setSpeech: (active: boolean) => {
      if (speech === active) return;
      speech = active; speechElements = []; stop(); stopResume(); resumeCandidate = false;
      previousTop = node.scrollTop;
      if (active) following = true;
      updateReturnControl();
    },
    setSpeechTarget: (elements: HTMLElement[]) => {
      if (!speech) return;
      speechElements = elements;
      if (following) animate();
      else if (!nearSpeech()) { stopResume(); resumeCandidate = false; }
      updateReturnControl();
      // A new subtitle or LLM delta is not manual re-entry into the center band.
    },
    resize: () => {
      if (following) animate();
      else if (!speech && atBottom()) follow();
      updateReturnControl();
    },
    destroy: () => {
      stop(); stopResume(); resumeCandidate = false;
      node.removeEventListener("scroll", onScroll); node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onPointer); node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove); node.removeEventListener("keydown", onKey);
      gestureTarget.removeEventListener("pointerup", onPointerEnd); gestureTarget.removeEventListener("pointercancel", onPointerEnd);
      gestureTarget.removeEventListener("touchend", onTouchEnd); gestureTarget.removeEventListener("touchcancel", onTouchEnd);
    },
  };
}
