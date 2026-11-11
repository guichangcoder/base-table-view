/**
 * 单元格值 ↔ 展示文本 / 表单值 的转换。
 * 读取侧统一落成字符串展示；写入侧按字段类型还原成 SDK 需要的开放值形态。
 */
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite } from '../types';

const FT = FieldType as any;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 毫秒时间戳 → YYYY-MM-DD HH:mm（零点省略时分） */
export function formatDateTime(ms: number): string {
  if (!ms || typeof ms !== 'number') return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return date;
  return `${date} ${pad(h)}:${pad(m)}`;
}

function isObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 文本 / URL 单元格：可能是 string，也可能是 segment 数组 */
function segmentsToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((seg) => {
        if (typeof seg === 'string') return seg;
        if (isObject(seg)) return String(seg.text ?? seg.link ?? seg.name ?? '');
        return String(seg ?? '');
      })
      .join('');
  }
  if (isObject(value)) return String(value.text ?? value.link ?? '');
  return '';
}

function selectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isObject(value)) return String(value.text ?? value.name ?? value.id ?? '');
  return '';
}

function usersToText(value: unknown): string {
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .map((u) => {
      if (typeof u === 'string') return u;
      if (isObject(u)) return String(u.name ?? u.enName ?? u.en_name ?? u.id ?? '');
      return '';
    })
    .filter(Boolean)
    .join('、');
}

function attachmentsToText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value
    .map((a) => (isObject(a) ? String(a.name ?? '') : ''))
    .filter(Boolean)
    .join('、');
}

function linksToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'string') return v;
        if (isObject(v)) return String(v.text ?? v.name ?? '');
        return '';
      })
      .filter(Boolean)
      .join('、');
  }
  if (isObject(value)) return String(value.text ?? value.name ?? '');
  return '';
}

/** 关联单元格 → 关联记录 id 列表（兼容 recordIds / 数组 / 单值） */
function linkIds(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(linkIds);
  if (typeof value === 'string') return value ? [value] : [];
  if (isObject(value)) {
    const ids = value.recordIds ?? value.record_ids ?? value.recordId ?? value.id;
    if (Array.isArray(ids)) return ids.map(String).filter(Boolean);
    if (typeof ids === 'string' && ids) return [ids];
  }
  return [];
}

function locationToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isObject(value)) return String(value.fullAddress ?? value.full_address ?? value.name ?? value.address ?? '');
  return '';
}

function anyToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    const parts = value.map(anyToText).filter(Boolean);
    return parts.join('、');
  }
  if (isObject(value)) {
    const inner = value.text ?? value.name ?? value.value;
    if (inner !== undefined) return anyToText(inner);
    return '';
  }
  return '';
}

/** 单元格值 → 展示文本 */
export function formatCellValue(value: unknown, field?: FieldMetaLite): string {
  if (value === null || value === undefined) return '';
  const type = field?.type;
  switch (type) {
    case FT.Text:
    case FT.Url:
      return segmentsToText(value);
    case FT.Number:
    case FT.Currency:
    case FT.Progress:
    case FT.Rating:
      return typeof value === 'number' ? String(value) : anyToText(value);
    case FT.SingleSelect:
      return selectText(value);
    case FT.MultiSelect:
      return Array.isArray(value)
        ? value.map(selectText).filter(Boolean).join('、')
        : selectText(value);
    case FT.DateTime:
    case FT.CreatedTime:
    case FT.ModifiedTime:
      return typeof value === 'number' ? formatDateTime(value) : anyToText(value);
    case FT.Checkbox:
      return value === true ? '是' : '';
    case FT.User:
    case FT.CreatedUser:
    case FT.ModifiedUser:
      return usersToText(value);
    case FT.Attachment:
      return attachmentsToText(value);
    case FT.SingleLink:
    case FT.DuplexLink:
      return linksToText(value);
    case FT.Phone:
    case FT.Email:
      return typeof value === 'string' ? value : anyToText(value);
    case FT.Location:
      return locationToText(value);
    default:
      return anyToText(value);
  }
}

/** 是否为空值（必填校验用） */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return Number.isNaN(value);
  if (typeof value === 'boolean') return value === false;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 表单可编辑值（受控输入用） */
export type FormValue = string | number | boolean | string[] | null;

/** 单元格值 → 表单值 */
export function toFormValue(value: unknown, field: FieldMetaLite): FormValue {
  const type = field.type;
  if (value === null || value === undefined) {
    if (type === FT.Checkbox) return false;
    if (type === FT.MultiSelect || type === FT.User) return [];
    if (type === FT.SingleLink || type === FT.DuplexLink) return [];
    return '';
  }
  switch (type) {
    case FT.Text:
    case FT.Phone:
    case FT.Email:
    case FT.Url:
      return segmentsToText(value);
    case FT.Number:
    case FT.Currency:
    case FT.Progress:
    case FT.Rating:
      return typeof value === 'number' ? value : Number(value) || '';
    case FT.SingleSelect: {
      if (isObject(value)) return String(value.id ?? '');
      return String(value);
    }
    case FT.MultiSelect: {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((v) => (isObject(v) ? String(v.id ?? '') : String(v))).filter(Boolean);
    }
    case FT.DateTime:
      return typeof value === 'number' ? value : '';
    case FT.Checkbox:
      return value === true;
    case FT.User: {
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((u) => (isObject(u) ? String(u.id ?? '') : String(u))).filter(Boolean);
    }
    case FT.SingleLink:
    case FT.DuplexLink:
      return linkIds(value);
    default:
      return formatCellValue(value, field);
  }
}

/**
 * 表单值 → 写入值。返回 undefined 表示该字段不参与本次写入。
 * 关联字段写入开放值 `{ recordIds, tableId }`，tableId 由字段元信息/关联展示配置提供。
 */
export function buildFieldValue(
  type: number,
  raw: unknown,
  linkTableId?: string,
): unknown | undefined {
  switch (type) {
    case FT.Text:
    case FT.Phone:
    case FT.Email:
    case FT.Url: {
      const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
      return s;
    }
    case FT.Number:
    case FT.Currency:
    case FT.Progress:
    case FT.Rating: {
      if (raw === '' || raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isNaN(n) ? null : n;
    }
    case FT.SingleSelect: {
      const id = typeof raw === 'string' ? raw : '';
      return id ? { id } : null;
    }
    case FT.MultiSelect: {
      const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : [];
      return ids.map((id) => ({ id }));
    }
    case FT.DateTime: {
      if (raw === '' || raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isNaN(n) ? null : n;
    }
    case FT.Checkbox:
      return raw === true;
    case FT.User: {
      const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : [];
      return ids.map((id) => ({ id }));
    }
    case FT.SingleLink:
    case FT.DuplexLink: {
      const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : [];
      const out: Record<string, unknown> = { recordIds: ids };
      if (linkTableId) out.tableId = linkTableId;
      return out;
    }
    default:
      return undefined;
  }
}