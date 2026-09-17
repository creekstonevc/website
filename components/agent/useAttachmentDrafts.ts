"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ATTACHMENT_FILES, MAX_TURN_BYTES, DEFAULT_FILE_BYTES } from "../../lib/agent-attachments.mjs";
import { AgentRequestError, attachmentError, readAttachmentFiles, uploadAttachment, type AttachmentFile } from "./agent-client";

export type AttachmentDraft = {
  id: string; name: string; size: number; phase: "uploading" | "ready" | "error";
  file?: AttachmentFile; error?: string; warning?: string;
};

const storageKey = (key: string) => `creekstone.attachments.${key}`;

// Keep only receipts/metadata, never file bytes, in browser draft storage.
// All asynchronous work is scoped to a generation as well as a conversation.
export function useAttachmentDrafts() {
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [notice, setNotice] = useState("");
  const current = useRef<AttachmentDraft[]>([]);
  const key = useRef("");
  const generation = useRef(0);
  const transfers = useRef(new Map<string, AbortController>());
  const sources = useRef(new Map<string, File>());
  const running = useRef(false);

  const update = useCallback((items: AttachmentDraft[]) => {
    current.current = items;
    setDrafts(items);
    if (!key.current) return;
    try {
      if (items.length) localStorage.setItem(storageKey(key.current), JSON.stringify(items));
      else localStorage.removeItem(storageKey(key.current));
    } catch { /* In-memory drafts still work in private browsing. */ }
  }, []);

  const restore = useCallback((sessionKey: string) => {
    if (key.current === sessionKey) return;
    generation.current++;
    for (const transfer of transfers.current.values()) transfer.abort();
    transfers.current.clear(); sources.current.clear(); running.current = false;
    key.current = sessionKey;
    setNotice("");
    let items: AttachmentDraft[] = [];
    try {
      const saved: AttachmentDraft[] = JSON.parse(localStorage.getItem(storageKey(sessionKey)) || "[]");
      if (Array.isArray(saved)) items = saved.slice(0, MAX_ATTACHMENT_FILES).flatMap((item) => {
        if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.size !== "number") return [];
        const file = readAttachmentFiles([item.file])[0];
        return [{ id: item.id, name: item.name, size: item.size,
          phase: file ? "ready" as const : "error" as const, file,
          ...(file ? {} : { error: "上传未确认，请移除后重新选择文件。" }) }];
      });
    } catch { /* Corrupt or unavailable storage must not block chat. */ }
    update(items);
  }, [update]);

  useEffect(() => {
    const active = transfers.current;
    const revision = generation;
    return () => { revision.current++; for (const transfer of active.values()) transfer.abort(); };
  }, []);

  const runQueue = async () => {
    if (running.current) return;
    running.current = true;
    const ownGeneration = generation.current;
    const ownKey = key.current;
    try {
      while (generation.current === ownGeneration) {
        const next = current.current.find((item) => item.phase === "uploading" && sources.current.has(item.id));
        if (!next) break;
        const controller = new AbortController();
        transfers.current.set(next.id, controller);
        try {
          const result = await uploadAttachment(sources.current.get(next.id)!, ownKey, controller.signal);
          if (generation.current !== ownGeneration) return;
          update(current.current.map((item) => item.id === next.id ?
            { ...item, phase: "ready", file: result.file, warning: result.warning, error: undefined } : item));
          sources.current.delete(next.id);
        } catch (error) {
          if (generation.current !== ownGeneration) return;
          update(current.current.map((item) => item.id === next.id ? { ...item, phase: "error", error: attachmentError(error) } : item));
        } finally { if (generation.current === ownGeneration) transfers.current.delete(next.id); }
      }
    } finally { if (generation.current === ownGeneration) running.current = false; }
  };

  const add = (files: File[]) => {
    if (!key.current) return;
    const items = current.current.slice();
    const errors: string[] = [];
    for (const file of files) {
      if (items.length >= MAX_ATTACHMENT_FILES) { errors.push("每条消息最多 3 个附件。"); break; }
      if (file.size > DEFAULT_FILE_BYTES || !file.size) {
        errors.push(`${file.name}：${attachmentError(new AgentRequestError(400, file.size ? "attachment_too_large" : "invalid_attachment_data"))}`);
        continue;
      }
      if (items.reduce((sum, item) => sum + item.size, 0) + file.size > MAX_TURN_BYTES) { errors.push("每条消息的附件总大小不能超过 10 MB。"); continue; }
      const id = crypto.randomUUID();
      sources.current.set(id, file);
      items.push({ id, name: file.name.normalize("NFC"), size: file.size, phase: "uploading" });
    }
    setNotice(errors.join(" "));
    update(items);
    void runQueue();
  };

  const remove = (id: string) => {
    transfers.current.get(id)?.abort();
    sources.current.delete(id);
    update(current.current.filter((item) => item.id !== id));
    setNotice("");
  };

  const retry = (id: string) => {
    if (!sources.current.has(id)) { setNotice("原文件不在当前页面，请移除后重新选择。已保存的文件不会被自动删除。"); return; }
    update(current.current.map((item) => item.id === id ? { ...item, phase: "uploading", error: undefined } : item));
    void runQueue();
  };

  const replace = useCallback((files: AttachmentFile[]) => {
    update(files.map((file) => ({ id: crypto.randomUUID(), name: file.name, size: file.size || 0, phase: "ready", file })));
    setNotice("");
  }, [update]);

  return { drafts, notice, restore, add, remove, retry, replace,
    blocked: drafts.some((item) => item.phase !== "ready"),
    snapshot: () => current.current.filter((item) => item.phase === "ready" && item.file).map((item) => item.file!),
    hasPending: () => current.current.some((item) => item.phase !== "ready"),
    clear: () => { update([]); setNotice(""); sources.current.clear(); },
  };
}
