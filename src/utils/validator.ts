/** 表单必填校验（只看前端可见、必填、可编辑的字段） */
import type { FieldConfig, FieldMetaLite } from '../types';
import { isEmptyValue } from './valueConverter';

export interface MissingField {
  fieldId: string;
  label: string;
}

export function fieldLabel(field: FieldMetaLite | undefined, cfg?: FieldConfig): string {
  const alias = cfg?.label?.trim();
  if (alias) return alias;
  return field?.name ?? cfg?.fieldId ?? '';
}

export function validateRequired(
  fields: FieldMetaLite[],
  configs: FieldConfig[],
  values: Record<string, unknown>,
): MissingField[] {
  const missing: MissingField[] = [];
  const cfgMap = new Map(configs.map((c) => [c.fieldId, c]));

  fields.forEach((field) => {
    const cfg = cfgMap.get(field.id);
    if (!cfg || !cfg.required) return;
    if (!cfg.visible) return;
    if (!field.editable || field.readonlyType) return;
    if (cfg.readonly) return;
    if (isEmptyValue(values[field.id])) {
      missing.push({ fieldId: field.id, label: fieldLabel(field, cfg) });
    }
  });

  return missing;
}