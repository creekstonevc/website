"use client";

import { useEffect, useRef, useState } from "react";
import { attachmentReferencePath, formatFileSize, type AttachmentReference } from "../../lib/agent-attachments.mjs";
import { attachmentError, downloadAttachment, type AttachmentFile } from "./agent-client";
import type { AttachmentDraft } from "./useAttachmentDrafts";
import styles from "./AgentChat.module.css";

export function FileGlyph({ attach = false }: { attach?: boolean }) {
  return <svg className={styles.fileGlyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {attach ? <path d="m8 13 6.6-6.6a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a5 5 0 0 1-7.1-7.1l8-8m4.4 5.2-7.6 7.6a1.2 1.2 0 0 1-1.7-1.7l6.5-6.5" /> :
      <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>}
  </svg>;
}

function DownloadFile({ file, sessionKey }: { file: AttachmentReference | AttachmentFile; sessionKey: string }) {
  const [state, setState] = useState<"idle" | "loading" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const transfer = useRef<AbortController | null>(null);
  const authorized = "ticket" in file;
  const extension = file.name.split(".").at(-1)?.toUpperCase();
  const kind = file.name.includes(".") && extension && /^[A-Z0-9]{1,8}$/.test(extension) ? extension : "FILE";
  const detail = !authorized ? "Download unavailable" : state === "loading" ? "Preparing download…" :
    state === "saved" ? "Download requested" : state === "error" ? "Transfer failed · try again" :
      file.size === undefined ? "Agent attachment" : formatFileSize(file.size);
  useEffect(() => () => transfer.current?.abort(), [sessionKey]);

  const download = async () => {
    if (transfer.current || !authorized) return;
    const controller = new AbortController();
    transfer.current = controller;
    setState("loading"); setError("");
    try {
      const blob = await downloadAttachment(file, sessionKey, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.name; link.rel = "noopener";
      link.hidden = true;
      document.body.append(link);
      link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("saved");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(attachmentError(cause)); setState("error");
    } finally { if (transfer.current === controller) transfer.current = null; }
  };

  return <li className={styles.attachmentCard} data-state={authorized ? state : "unavailable"}>
    <div className={styles.attachmentStamp} aria-hidden="true"><FileGlyph /><span>{kind}</span></div>
    <div className={styles.attachmentDetails}>
      <span className={styles.attachmentName}>{file.name}</span>
      <small role="status">{detail}</small>
    </div>
    <button type="button" className={styles.attachmentDownload} disabled={state === "loading" || !sessionKey || !authorized}
      aria-label={`${state === "error" ? "Retry download" : "Download"} ${file.name}`} onClick={() => void download()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {state === "saved" ? <path d="m5 12 4 4L19 6" /> : <path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" />}
      </svg>
      <span>{state === "loading" ? "Wait…" : state === "error" ? "Retry" : "Download"}</span>
    </button>
    {error && <p className={styles.attachmentError} role="status">{error}</p>}
  </li>;
}

export function MessageAttachments({ files, references, sessionKey }: {
  files?: AttachmentFile[]; references?: AttachmentReference[]; sessionKey: string;
}) {
  // Parsed paths may supply display metadata, never download authority.
  const entries = new Map<string, AttachmentReference | AttachmentFile>();
  for (const reference of references || []) entries.set(attachmentReferencePath(reference.path), reference);
  for (const file of files || []) entries.set(attachmentReferencePath(file.path), file);
  if (!entries.size) return null;
  return <ul className={styles.attachmentCards} aria-label="Message attachments">
    {[...entries.values()].map((file) => <DownloadFile key={`${sessionKey}:${file.path}`} file={file} sessionKey={sessionKey} />)}
  </ul>;
}

export function PendingAttachments({ drafts, onRemove, onRetry }: {
  drafts: AttachmentDraft[]; onRemove: (id: string) => void; onRetry: (id: string) => void;
}) {
  if (!drafts.length) return null;
  return <ul className={`${styles.attachmentList} ${styles.pendingAttachments}`} aria-label="Attachments to send">
    {drafts.map((item) => <li className={styles.attachmentRow} key={item.id} data-phase={item.phase}>
      <FileGlyph />
      <div className={styles.attachmentDetails}>
        <span className={styles.attachmentName}>{item.name}</span>
        <small>{formatFileSize(item.size)} · {item.phase === "ready" ? "Uploaded · ready to send" : item.phase === "uploading" ? "Uploading…" : "Upload not confirmed"}</small>
      </div>
      <div className={styles.attachmentActions}>
        {item.phase === "error" && <button type="button" className={styles.attachmentAction} aria-label={`Retry upload ${item.name}`} onClick={() => onRetry(item.id)}>Retry</button>}
        <button type="button" className={styles.attachmentAction} aria-label={`Remove ${item.name}`} onClick={() => onRemove(item.id)}>Remove</button>
      </div>
      {(item.error || item.warning) && <p className={styles.attachmentError} role="status">{item.error || item.warning}</p>}
    </li>)}
  </ul>;
}
