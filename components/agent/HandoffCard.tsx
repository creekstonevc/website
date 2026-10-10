"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EMPTY_HANDOFF, HANDOFF_LIMITS, HANDOFF_PURPOSE, handoffContent, type HandoffContent } from "../../lib/handoff.mjs";
import { canEditHandoff, handoffErrorText, handoffStateText, HandoffError, requestHandoff, sameHandoffContent, type HandoffSnapshot } from "./handoff-client";
import styles from "./HandoffCard.module.css";

// THESIS: explicit user review is the only bridge from chat to a founder handoff.
// OWN-WORLD: existing black/gold, Space Grotesk, sharp rules; no new visual world.
// STORY: see exactly what is shared, edit, then confirm or defer without pressure.
// FIRST VIEWPORT: an inline review sheet in the transcript, content before actions.
// FORM: local extension; inherited design, no concept roll or extra modal.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
export function HandoffCard({ sessionKey, openRequest, chatBusy, onOpen }: {
  sessionKey: string; openRequest: { sessionKey: string; sequence: number } | null; chatBusy: boolean; onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissedSequence, setDismissedSequence] = useState(0);
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [content, setContent] = useState<HandoffContent>({ ...EMPTY_HANDOFF });
  const [pending, setPending] = useState("");
  const [note, setNote] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [locallyDeferred, setLocallyDeferred] = useState(false);
  const root = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const dirtyRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const editVersion = useRef(0);
  const seenDraft = useRef("");
  const draft = snapshot?.draft || null;
  const dirty = draft ? !sameHandoffContent(content, draft.content) : !!Object.values(content).some(Boolean);
  useLayoutEffect(() => { dirtyRef.current = dirty; snapshotRef.current = snapshot; }, [dirty, snapshot]);
  const requested = openRequest?.sessionKey === sessionKey && openRequest.sequence !== dismissedSequence;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const sync = useCallback(async (explicit = false) => {
    if (!sessionKey || operation.current) return;
    // Never overwrite a founder's in-progress edits with a poll/agent update.
    if (!explicit && dirtyRef.current) return;
    operation.current = true;
    if (explicit) setPending("status");
    const beforeEdit = editVersion.current;
    try {
      const current = snapshotRef.current?.draft;
      const result = await requestHandoff("status", sessionKey, current ? { draft_id: current.draft_id } : {});
      if (!mounted.current) return;
      setSnapshot(result); setUncertain(false); setNote("");
      if (result.draft) {
        if (beforeEdit === editVersion.current && (!dirtyRef.current || explicit)) {
          setContent(result.draft.content);
          setNote(explicit ? "已同步服务端记录，请检查当前版本。" : "");
        }
        const reference = `${result.draft.draft_id}:${result.draft.revision}`;
        if (seenDraft.current !== reference) setOpen(true);
        seenDraft.current = reference;
      } else if (explicit) setNote(result.available ? "当前会话没有已保存的草稿，未发生转交。" : "转交服务尚未开通，这里的内容还没有保存或发送。");
    } catch (error) {
      if (mounted.current) { setNote(handoffErrorText(error)); setUncertain(true); }
    } finally { operation.current = false; if (mounted.current) setPending(""); }
  }, [sessionKey]);

  useEffect(() => { if (!chatBusy) void Promise.resolve().then(() => { if (mounted.current) return sync(); }); }, [chatBusy, sync]);
  useEffect(() => {
    const focus = () => { if (!dirtyRef.current) void sync(); };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [sync]);
  useEffect(() => {
    if (openRequest?.sessionKey !== sessionKey) return;
    onOpen();
    const frame = requestAnimationFrame(() => {
      root.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      root.current?.focus({ preventScroll: true });
    });
    void Promise.resolve().then(() => { if (mounted.current) return sync(); });
    return () => cancelAnimationFrame(frame);
  }, [openRequest, sessionKey, onOpen, sync]);

  async function act(kind: "save" | "confirm" | "defer") {
    if (operation.current) return;
    if (kind === "defer" && (!draft || !snapshot?.available)) {
      setLocallyDeferred(true); setNote("暂不转交。没有向团队发送任何内容。"); return;
    }
    if (kind === "confirm" && (dirty || uncertain || !draft || !snapshot?.canSubmit || !content.contact.trim())) return;
    operation.current = true; setPending(kind); setNote("");
    try {
      let result;
      if (kind === "save") {
        const normalized = handoffContent(content);
        if (!normalized) throw new HandoffError("handoff_invalid");
        const editable = draft && !["declined", "expired"].includes(draft.state);
        result = await requestHandoff("prepare", sessionKey, { content: normalized,
          ...(editable ? { draft_id: draft.draft_id, revision: draft.revision } : {}) });
      } else {
        if (!draft?.confirmation_nonce) throw new HandoffError("confirmation_expired");
        result = await requestHandoff("decision", sessionKey, { draft_id: draft.draft_id, revision: draft.revision,
          confirmation_nonce: draft.confirmation_nonce, action: kind === "confirm" ? "confirm" : "defer" });
      }
      if (!mounted.current) return;
      setSnapshot(result); setUncertain(false); setLocallyDeferred(false);
      if (result.draft) setContent(result.draft.content);
      if (kind === "save") setNote("草稿已保存，但未转交。请检查这一版内容，再确认。");
      if (kind === "defer") setNote("暂不转交。这份草稿没有发送给团队。");
    } catch (error) {
      if (!mounted.current) return;
      setNote(handoffErrorText(error));
      // Never infer failure/success or blind-retry after lost responses.
      setUncertain(true);
    } finally { operation.current = false; if (mounted.current) setPending(""); }
  }

  if (!open && !requested) return null;
  const editable = canEditHandoff(draft) && !pending && !uncertain;
  const submitted = draft?.state === "submitted";
  const expired = draft?.state === "expired";
  const needsSave = !draft || dirty || ["declined", "expired"].includes(draft.state) || locallyDeferred;
  const canConfirm = snapshot?.canSubmit && !needsSave && !uncertain && !pending && !expired && draft?.confirmation_nonce && content.contact.trim() &&
    ["awaiting_confirmation", "confirmed", "failed"].includes(draft.state);
  const fields = (Object.keys(HANDOFF_LIMITS) as (keyof HandoffContent)[]);
  const labels: Record<keyof HandoffContent, string> = { summary: "项目与诉求摘要", contact: "联系方式", founder_name: "你的称呼（选填）", project_name: "项目名称（选填）" };

  return <section ref={root} className={styles.card} tabIndex={-1} aria-labelledby="handoff-title" aria-busy={!!pending}>
    <header className={styles.header}>
      <h2 id="handoff-title">转交确认卡</h2>
      <button type="button" className={styles.close} aria-label="收起确认卡" onClick={() => { setOpen(false); setDismissedSequence(openRequest?.sequence || 0); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <p className={styles.status} role="status">{pending === "confirm" ? "正在确认并转交，请稍候…" : uncertain ? "结果待核实" : locallyDeferred ? "暂不转交" : handoffStateText(draft)}{draft && <span>第 {draft.revision} 版</span>}</p>
    <p className={styles.purpose}>{draft?.purpose || HANDOFF_PURPOSE}</p>
    {!snapshot && !uncertain && <p className={styles.notice}>正在核实转交服务状态。核实前不会保存或发送任何内容。</p>}
    {snapshot && !snapshot.available && <p className={styles.notice}>转交服务尚未开通。你可以先整理内容，但本页不会保存或向团队发送；聊天不受影响。</p>}
    {snapshot?.available && !snapshot.canSubmit && <p className={styles.notice}>确认转交入口暂未开通，本页不会发起新的提交。已有申请请以同步结果为准。</p>}
    {submitted ? <dl className={styles.readback}>
      {fields.map(key => content[key] && <div key={key}><dt>{labels[key]}</dt><dd>{content[key]}</dd></div>)}
    </dl> : <div className={styles.fields}>
      {fields.map(key => <label key={key} className={key === "summary" || key === "contact" ? styles.full : ""}>
        <span>{labels[key]}{key === "summary" && <small>{[...content.summary].length} / 1,200</small>}</span>
        {key === "summary" ? <textarea rows={4} value={content[key]} maxLength={HANDOFF_LIMITS[key]} disabled={!editable}
          placeholder="用几句话说明你正在做什么，以及希望交流的问题。"
          onChange={event => { editVersion.current++; setLocallyDeferred(false); setContent(current => ({ ...current, [key]: event.target.value })); }} />
          : <input value={content[key]} maxLength={HANDOFF_LIMITS[key]} disabled={!editable} autoComplete="off"
            placeholder={key === "contact" ? "你愿意提供的微信、邮箱或电话" : "可留空"}
            onChange={event => { editVersion.current++; setLocallyDeferred(false); setContent(current => ({ ...current, [key]: event.target.value })); }} />}
      </label>)}
    </div>}
    <p className={styles.disclosure}>仅转交卡中内容，并记录当前会话编号、提交编号、来源与提交时间；不附带完整聊天或附件。联系方式由你提供，不会自动猜测。</p>
    {dirty && draft && <p className={styles.notice}>内容有修改。保存后需重新确认，旧版本不能用于转交。</p>}
    {note && <p className={styles.notice} role="status">{note}</p>}
    {submitted ? <div className={styles.receipt}>
      <p>已进入待审阅记录，不代表真人已接受或会议已安排。</p>
      <p>尚未发送通知。</p>
      <span>转交回执</span><code>{draft.result?.reference_id}</code>
    </div> : <div className={styles.actions}>
      {needsSave ? <button type="button" className={styles.primary} disabled={!snapshot?.available || !!pending || uncertain || !handoffContent(content)} onClick={() => void act("save")}>
        {pending === "save" ? "保存中…" : "保存草稿，继续确认"}
      </button> : <button type="button" className={styles.primary} disabled={!canConfirm} onClick={() => void act("confirm")}>
        {pending === "confirm" ? "正在转交…" : "确认转交"}
      </button>}
      <button type="button" disabled={!!pending || !!draft && !canEditHandoff(draft)} onClick={() => void act("defer")}>暂不转交</button>
    </div>}
    {(draft || uncertain) && <button type="button" className={styles.sync} disabled={!!pending}
      onClick={() => { if (!dirty || window.confirm("同步最新版本会替换卡中尚未保存的编辑，继续吗？")) void sync(true); }}>
      {pending === "status" ? "同步中…" : "同步转交状态"}
    </button>}
  </section>;
}
