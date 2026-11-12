import { DatePicker, Input, InputNumber, Select, Switch, Tag } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite } from '../../types';
import type { SelectOptionLite } from '../../services/baseService';
import type { UserCandidate } from '../../services/recordService';
import type { FormValue } from '../../utils/valueConverter';
import { typeLabel } from '../config/FieldSection';
import { LinkFieldSelect } from './LinkFieldSelect';

const FT = FieldType as any;

interface Props {
  field: FieldMetaLite;
  value: FormValue;
  onChange: (v: FormValue) => void;
  /** 单选/多选的可选选项（原生选项优先） */
  options?: SelectOptionLite[];
  /** 人员字段候选值 */
  userOptions?: UserCandidate[];
  /** 关联字段的目标表 id */
  linkTableId?: string;
  /** 展示用字段名（配置了自定义标签时优先） */
  label?: string;
  /** 取不到关联表等场景下的兜底展示文本 */
  fallbackText?: string;
}

/** 单个字段的录入控件：新增/编辑表单与单据表单共用 */
export function FieldEditor({
  field,
  value,
  onChange,
  options = [],
  userOptions = [],
  linkTableId,
  label,
  fallbackText,
}: Props) {
  const v = value;

  switch (field.type) {
    case FT.Text:
      return (
        <Input
          value={String(v ?? '')}
          placeholder={`请输入${label || field.name}`}
          onChange={(val) => onChange(val)}
        />
      );
    case FT.Phone:
    case FT.Email:
    case FT.Url:
      return (
        <Input
          value={String(v ?? '')}
          placeholder={`请输入${typeLabel(field.type)}`}
          onChange={(val) => onChange(val)}
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
          onChange={(n) => onChange(typeof n === 'number' ? n : '')}
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
          optionList={options.map((o) => ({ label: o.name, value: o.id }))}
          onChange={(val) => onChange(val ? String(val) : '')}
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
          optionList={options.map((o) => ({ label: o.name, value: o.id }))}
          onChange={(val) => onChange(Array.isArray(val) ? val.map(String) : [])}
        />
      );
    case FT.DateTime:
      return (
        <DatePicker
          type="dateTime"
          style={{ width: '100%' }}
          value={typeof v === 'number' && v ? new Date(v) : undefined}
          onChange={(d: any) => onChange(d instanceof Date ? d.getTime() : '')}
        />
      );
    case FT.Checkbox:
      return <Switch checked={v === true} onChange={(checked) => onChange(!!checked)} />;
    case FT.User:
      return (
        <Select
          multiple
          value={Array.isArray(v) ? v : []}
          placeholder={userOptions.length ? '请选择人员' : '正在读取人员候选…'}
          filter
          maxTagCount={4}
          style={{ width: '100%' }}
          optionList={userOptions.map((u) => ({ label: u.name, value: u.id }))}
          onChange={(val) => onChange(Array.isArray(val) ? val.map(String) : [])}
        />
      );
    case FT.SingleLink:
    case FT.DuplexLink: {
      if (!linkTableId) {
        return (
          <div className="form-readonly">
            {fallbackText || '—'}
            <Tag size="small" color="grey">
              无法获取关联表
            </Tag>
          </div>
        );
      }
      return (
        <LinkFieldSelect
          key={linkTableId}
          tableId={linkTableId}
          value={Array.isArray(v) ? v.map(String) : []}
          onChange={(ids) => onChange(ids)}
        />
      );
    }
    default:
      return (
        <div className="form-readonly">
          {fallbackText || '—'}
          <Tag size="small" color="grey">
            暂不支持编辑
          </Tag>
        </div>
      );
  }
}
