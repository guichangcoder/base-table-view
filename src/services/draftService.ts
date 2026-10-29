/**
 * 记录表单草稿：新建 / 编辑时未提交的填写内容。
 *
 * 只存在本机浏览器（localStorage），不上传、不写入数据表，
 * 因此刷新页面后还能回到刚才填写的位置，也不会影响其他用户。
 * 按「多维表格 + 数据表」隔离，避免不同表之间串草稿。
 */
import { getBaseToken } from './appContext';
import type { FormValue } from '../utils/valueConverter';

export interface RecordDraft {
  mode: 'create' | 'edit';
  /** 编辑态对应的记录 id；新建态为空 */
  recordId?: string;
  values: Record<string, FormValue>;
  savedAt: number;
}

const PREFIX = 'bitable-record-view-plugin:draft';

function keyOf(tableId: string): string {
  const baseId = getBaseToken() || 'default';
  return `${PREFIX}:${baseId}:${tableId}`;
}

function isFormValue(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    (Array.isArray(v) && v.every((x) => typeof x === 'string'))
  );
}

/** 保存草稿；浏览器存储不可用时返回 false（调用方据此提示用户） */
export function saveDraft(tableId: string, draft: RecordDraft): boolean {
  if (!tableId) return false;
  try {
    localStorage.setItem(keyOf(tableId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** 读取草稿；结构不合法或已损坏时返回 null 并清除 */
export function loadDraft(tableId: string): RecordDraft | null {
  if (!tableId) return null;
  try {
    const raw = localStorage.getItem(keyOf(tableId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecordDraft;
    if (!parsed || (parsed.mode !== 'create' && parsed.mode !== 'edit')) {
      clearDraft(tableId);
      return null;
    }
    const values: Record<string, FormValue> = {};
    Object.entries(parsed.values ?? {}).forEach(([k, v]) => {
      if (isFormValue(v)) values[k] = v as FormValue;
    });
    return {
      mode: parsed.mode,
      recordId: typeof parsed.recordId === 'string' ? parsed.recordId : undefined,
      values,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    clearDraft(tableId);
    return null;
  }
}

export function clearDraft(tableId: string): void {
  if (!tableId) return;
  try {
    localStorage.removeItem(keyOf(tableId));
  } catch {
    /* 隐私模式下忽略 */
  }
}