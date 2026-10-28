import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, InputNumber, Select, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite, PluginData, RecordRow } from '../../types';
import { isButtonField, visibleFieldIds } from '../../utils/configOps';
import { isEditableType } from '../../services/baseService';
import { listUserCandidates, type UserCandidate } from '../../services/recordService';
import {
  buildFieldValue,
  formatCellValue,
  toFormValue,
  type FormValue,
} from '../../utils/valueConverter';
import { fieldLabel, validateRequired } from '../../utils/validator';
import { toneOf } from '../../utils/palette';
import { typeLabel } from '../config/FieldSection';
import { RecordButton } from '../view/RecordButton';

const FT = FieldType as any;

/** 表单值是否与记录原值一致：编辑态据此只提交真正改动的字段 */
function sameFormValue(a: FormValue, b: FormValue): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  config: PluginData;
  fields: FieldMetaLite[];
  record?: RecordRow | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}

/** 新增 / 编辑记录表单：按分组渲染，必填校验通过后写回数据表 */
export function RecordForm({ open, mode, config, fields, record, saving, onCancel, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [missing, setMissing] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, UserCandidate[]>>({});

  const cfgMap = useMemo(() => new Map(config.fields.map((c) => [c.fieldId, c])), [config.fields]);
  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  // 字段是否允许前端编辑：类型可编辑 且 配置未关闭「可编辑」
  const canEdit = (f: FieldMetaLite): boolean => isEditableType(f.type) && cfgMap.get(f.id)?.readonly !== true;

  const blocks = useMemo(
    () =>
      config.groups
        .map((group) => ({
          group,
          ids: visibleFieldIds(config, group).filter((id) => fieldMap.has(id)),
        }))
        .filter((b) => b.ids.length > 0),
    [config, fieldMap],
  );

  const formFields = useMemo(
    () => blocks.flatMap((b) => b.ids).map((id) => fieldMap.get(id)).filter((f): f is FieldMetaLite => !!f),
    [blocks, fieldMap],
  );

  // 打开表单时按记录值初始化
  useEffect(() => {
    if (!open) return;
    const next: Record<string, FormValue> = {};
    formFields.forEach((f) => {
      if (!canEdit(f)) return;
      next[f.id] = toFormValue(record?.fields?.[f.id], f);
    });
    setValues(next);
    setMissing({});
  }, [open, mode, record?.recordId, formFields]);

  // 人员字段候选值（取列内已有人员 + 当前用户）
  useEffect(() => {
    if (!open || !config.tableId) return;
    let alive = true;
    const target = formFields.filter((f) => f.type === FT.User && !users[f.id]);
    target.forEach((f) => {
      listUserCandidates(config.tableId as string, f.id)
        .then((list) => {
          if (alive) setUsers((prev) => ({ ...prev, [f.id]: list }));
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config.tableId, formFields]);

  if (!open) return null;

  const setValue = (fieldId: string, v: FormValue) => {
    setValues((prev) => ({ ...prev, [fieldId]: v }));
    setMissing((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const handleSubmit = () => {
    const editable = formFields.filter(canEdit);
    const miss = validateRequired(editable, config.fields, values);
    if (miss.length) {
      setMissing(Object.fromEntries(miss.map((m) => [m.fieldId, m.label])));
      Toast.error(`请填写必填项：${miss.map((m) => m.label).join('、')}`);
      return;
    }

    const payload: Record<string, unknown> = {};
    editable.forEach((f) => {
      // 编辑态只提交改动过的字段：多人同时编辑同一条记录时，不会把别人刚改的字段覆盖回旧值
      if (mode === 'edit' && record && sameFormValue(values[f.id], toFormValue(record.fields?.[f.id], f))) {
        return;
      }
      const built = buildFieldValue(f.type, values[f.id]);
      if (built !== undefined) payload[f.id] = built;
    });
    if (mode === 'edit' && Object.keys(payload).length === 0) {
      Toast.info('没有任何字段被修改');
      return;
    }
    onSubmit(payload);
  };

  const renderInput = (field: FieldMetaLite) => {
    const cfg = cfgMap.get(field.id);
    const v = values[field.id];

    // 按钮字段不是可录入的值：直接渲染按钮，编辑态可执行，新增态提示先保存
    if (isButtonField(field, cfg)) {
      return (
        <RecordButton
          tableId={config.tableId}
          recordId={mode === 'edit' ? record?.recordId : undefined}
          field={field}
          title={cfg?.label || undefined}
        />
      );
    }

    if (!canEdit(field)) {
      const text = formatCellValue(record?.fields?.[field.id], field);
      return (
        <div className="form-readonly">
          {text || '—'}
          <Tag size="small" color="grey">
            只读
          </Tag>
        </div>
      );
    }

    switch (field.type) {
      case FT.Text:
        return (
          <Input
            value={String(v ?? '')}
            placeholder={`请输入${fieldLabel(field, cfg)}`}
            onChange={(val) => setValue(field.id, val)}
          />
        );
      case FT.Phone:
      case FT.Email:
      case FT.Url:
        return (
          <Input
            value={String(v ?? '')}
            placeholder={`请输入${typeLabel(field.type)}`}
            onChange={(val) => setValue(field.id, val)}
          />
        );
      case FT.Number:
      case FT.Currency:
      case FT.Progress:
      case FT.Rating:
        return (
          <InputNumber
            value={typeof v === 'number' ? v : undefined}
            placeholder="请输入数字"
            style={{ width: '100%' }}
            onChange={(n) => setValue(field.id, typeof n === 'number' ? n : '')}
          />
        );
      case FT.SingleSelect:
        return (
          <Select
            value={typeof v === 'string' && v ? v : undefined}
            placeholder="请选择"
            showClear
            filter
            style={{ width: '100%' }}
            optionList={(field.options ?? []).map((o) => ({ label: o.name, value: o.id }))}
            onChange={(val) => setValue(field.id, val ? String(val) : '')}
          />
        );
      case FT.MultiSelect:
        return (
          <Select
            multiple
            value={Array.isArray(v) ? v : []}
            placeholder="可多选"
            filter
            maxTagCount={4}
            style={{ width: '100%' }}
            optionList={(field.options ?? []).map((o) => ({ label: o.name, value: o.id }))}
            onChange={(val) => setValue(field.id, Array.isArray(val) ? val.map(String) : [])}
          />
        );
      case FT.DateTime:
        return (
          <DatePicker
            type="dateTime"
            style={{ width: '100%' }}
            value={typeof v === 'number' && v ? new Date(v) : undefined}
            onChange={(d: any) => setValue(field.id, d instanceof Date ? d.getTime() : '')}
          />
        );
      case FT.Checkbox:
        return (
          <Switch
            checked={v === true}
            onChange={(checked) => setValue(field.id, !!checked)}
          />
        );
      case FT.User: {
        const options = users[field.id] ?? [];
        return (
          <Select
            multiple
            value={Array.isArray(v) ? v : []}
            placeholder={options.length ? '请选择人员' : '正在读取人员候选…'}
            filter
            maxTagCount={4}
            style={{ width: '100%' }}
            optionList={options.map((u) => ({ label: u.name, value: u.id }))}
            onChange={(val) => setValue(field.id, Array.isArray(val) ? val.map(String) : [])}
          />
        );
      }
      default:
        return (
          <div className="form-readonly">
            {formatCellValue(record?.fields?.[field.id], field) || '—'}
            <Tag size="small" color="grey">
              暂不支持编辑
            </Tag>
          </div>
        );
    }
  };

  return (
    <div className="form-mask" onMouseDown={onCancel}>
      <div className="form-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="form-head">
          <div>
            <h2>{mode === 'create' ? '新增记录' : '编辑记录'}</h2>
            <span className="cfg-hint">
              带 <i className="field-required">*</i> 的为必填项，提交时会校验。
            </span>
          </div>
          <Button theme="borderless" onClick={onCancel}>
            关闭
          </Button>
        </header>

        <div className="form-body">
          {blocks.length === 0 ? (
            <div className="cfg-empty">当前配置没有可填写的字段，请先在配置面板中添加分组与字段</div>
          ) : (
            blocks.map(({ group, ids }) => {
              const tone = toneOf(group.color);
              return (
                <section
                  className="form-group"
                  key={group.id}
                  style={{ background: tone.bg, borderColor: tone.border }}
                >
                  <div className="form-group-head">
                    <i className="group-block-bar" style={{ background: tone.color }} />
                    <h3 style={{ color: tone.color }}>{group.name}</h3>
                  </div>
                  <div className={`form-grid cols-${group.columns}`}>
                    {ids.map((id) => {
                      const field = fieldMap.get(id);
                      if (!field) return null;
                      const cfg = cfgMap.get(id);
                      const isMissing = !!missing[id];
                      return (
                        <div className={`form-item${isMissing ? ' missing' : ''}`} key={id}>
                          <label className="form-label">
                            {fieldLabel(field, cfg)}
                            {cfg?.required && canEdit(field) ? (
                              <i className="field-required">*</i>
                            ) : null}
                          </label>
                          {renderInput(field)}
                          {isMissing ? <div className="form-error">请填写「{missing[id]}」</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <footer className="form-foot">
          <Button onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button theme="solid" type="primary" loading={saving} onClick={handleSubmit}>
            {mode === 'create' ? '提交新增' : '保存修改'}
          </Button>
        </footer>
      </div>
    </div>
  );
}