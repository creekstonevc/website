"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EMPTY_HANDOFF, HANDOFF_LIMITS, handoffContent, type HandoffContent } from "../../lib/handoff.mjs";
import { canEditHandoff, canPrefillHandoff, handoffErrorText, handoffPresentation, HandoffError, requestHandoff, sameHandoffContent, type HandoffOpenRequest, type HandoffSnapshot } from "./handoff-client";
import styles from "./HandoffCard.module.css";

// THESIS: explicit user review is the only bridge from chat to a founder handoff.
// OWN-WORLD: existing black/gold, Space Grotesk, sharp rules; no new visual world.
// STORY: see exactly what is shared, edit, then confirm or defer without pressure.
// FIRST VIEWPORT: an inline review sheet in the transcript, content before actions.
// FORM: local extension; inherited design, no concept roll or extra modal.
// FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
export function HandoffCard({ sessionKey, openRequest, chatBusy, onOpen }: {
  sessionKey: string; openRequest: HandoffOpenRequest | null; chatBusy: boolean; onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissedSequence, setDismissedSequence] = useState(0);
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [content, setContent] = useState<HandoffContent>({ ...EMPTY_HANDOFF });
  const [pending, setPending] = useState("");
  const [note, setNote] = useState("");
  const [proposalNotice, setProposalNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [locallyDeferred, setLocallyDeferred] = useState(false);
  const root = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const dirtyRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const editVersion = useRef(0);
  const seenDraft = useRef("");
  const seenProposal = useRef(0);
  const draft = snapshot?.draft || null;
  const dirty = draft ? !sameHandoffContent(content, draft.content) : !!Object.values(content).some(Boolean);
  useLayoutEffect(() => { dirtyRef.current = dirty; snapshotRef.current = snapshot; }, [dirty, snapshot]);
  const requested = openRequest?.sessionKey === sessionKey && openRequest.sequence !== dismissedSequence;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if ((!openRequest?.proposal && !openRequest?.notice) || openRequest.sessionKey !== sessionKey || !snapshot || pending || uncertain) return;
    const request = openRequest;
    void Promise.resolve().then(() => {
      if (!mounted.current || operation.current || seenProposal.current === request.sequence) return;
      seenProposal.current = request.sequence;
      if (request.notice) { setProposalNotice(request.notice); return; }
      if (request.proposal && canPrefillHandoff(snapshotRef.current, dirtyRef.current, uncertain)) {
        editVersion.current++;
        dirtyRef.current = true;
        setContent({ ...request.proposal });
        setLocallyDeferred(false);
        setProposalNotice("请核对 Agent 整理的摘要及你提供的联系方式。");
      } else {
        setProposalNotice("已保留你原有的内容，未采用 Agent 的新提案。");
      }
    });
  }, [openRequest, sessionKey, snapshot, pending, uncertain]);

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
    setProposalNotice("");
    if (kind === "defer" && (!draft || !snapshot?.available)) {
      setLocallyDeferred(true); setNote(""); return;
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
  const presentation = handoffPresentation(snapshot, dirty, uncertain, pending, locallyDeferred);

  return <section ref={root} className={styles.card} tabIndex={-1} aria-labelledby="handoff-title" aria-busy={!!pending}>
    <header className={styles.header}>
      <h2 id="handoff-title">转交确认卡</h2>
      <button type="button" className={styles.close} aria-label="收起确认卡" onClick={() => { setOpen(false); setDismissedSequence(openRequest?.sequence || 0); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <p className={styles.status} role="status">{presentation.status}</p>
    {!submitted && snapshot && !snapshot.available && <p className={styles.notice}>转交服务暂未开通，内容无法保存或提交。你可以继续聊天。</p>}
    {!submitted && snapshot?.available && !snapshot.canSubmit && <p className={styles.notice}>暂不能提交新的申请，已有记录仍会保留。</p>}
    {submitted ? <details className={styles.details}>
      <summary>查看已提交内容</summary>
      <dl className={styles.readback}>
        {fields.map(key => content[key] && <div key={key}><dt>{labels[key]}</dt><dd>{content[key]}</dd></div>)}
      </dl>
    </details> : <div className={styles.fields}>
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
    {!submitted && <>
      <p className={styles.purpose}>确认后，将以上内容交给 Creekstone 团队审阅。</p>
      <details className={styles.details}>
        <summary>数据使用说明</summary>
        <p>提交卡片中的摘要、联系方式及你填写的称呼和项目名称，同时记录会话与提交标识、来源和时间以追踪申请。不附带完整聊天或附件。</p>
      </details>
    </>}
    {note && <p className={styles.notice} role="status">{note}</p>}
    {proposalNotice && <p className={styles.notice} role="status">{proposalNotice}</p>}
    {!submitted && <div className={styles.actions}>
      {needsSave ? <button type="button" className={styles.primary} disabled={!snapshot?.available || !!pending || uncertain || !handoffContent(content)} onClick={() => void act("save")}>
        {pending === "save" ? "保存中…" : "保存草稿，继续确认"}
      </button> : <button type="button" className={styles.primary} disabled={!canConfirm} onClick={() => void act("confirm")}>
        {pending === "confirm" ? "正在转交…" : "确认转交"}
      </button>}
      <button type="button" disabled={!!pending || !!draft && !canEditHandoff(draft)} onClick={() => void act("defer")}>暂不转交</button>
    </div>}
    {presentation.showQuery && <button type="button" className={styles.sync} disabled={!!pending}
      onClick={() => { if (!dirty || window.confirm("重新查询会替换尚未保存的编辑，继续吗？")) void sync(true); }}>
      {pending === "status" ? "查询中…" : "重新查询"}
    </button>}
  </section>;
}
