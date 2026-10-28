import { Checkbox, Input, Select, Tag } from '@douyinfe/semi-ui';
import type { FieldConfig, FieldMetaLite, PluginData } from '../../types';
import { setFieldConfig } from '../../utils/configOps';
import { EMPHASIS_COLORS } from '../../utils/palette';
import { FieldType } from '@lark-base-open/js-sdk';

const FT = FieldType as any;

const TYPE_LABEL: Record<number, string> = {
  [FT.Text]: '文本',
  [FT.Number]: '数字',
  [FT.SingleSelect]: '单选',
  [FT.MultiSelect]: '多选',
  [FT.DateTime]: '日期',
  [FT.Checkbox]: '复选框',
  [FT.User]: '人员',
  [FT.Phone]: '电话',
  [FT.Url]: '链接',
  [FT.Attachment]: '附件',
  [FT.SingleLink]: '单向关联',
  [FT.DuplexLink]: '双向关联',
  [FT.Lookup]: '引用',
  [FT.Formula]: '公式',
  [FT.Location]: '地理位置',
  [FT.GroupChat]: '群组',
  [FT.CreatedTime]: '创建时间',
  [FT.ModifiedTime]: '修改时间',
  [FT.CreatedUser]: '创建人',
  [FT.ModifiedUser]: '修改人',
  [FT.AutoNumber]: '自动编号',
  [FT.Currency]: '货币',
  [FT.Progress]: '进度',
  [FT.Rating]: '评分',
  [FT.Email]: '邮箱',
};

export function typeLabel(type: number): string {
  return TYPE_LABEL[type] ?? '其他';
}

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  onChange: (next: PluginData) => void;
}

function emphasisColor(cfg?: FieldConfig): string {
  return cfg?.emphasis?.color ?? '';
}

/** 字段级配置：别名、显隐、必填、强调 */
export function FieldSection({ config, fields, onChange }: Props) {
  const cfgMap = new Map(config.fields.map((f) => [f.fieldId, f]));
  const list = fields.filter((f) => !f.unsupported);

  const patch = (fieldId: string, p: Partial<FieldConfig>) => {
    onChange(setFieldConfig(config, fieldId, p));
  };

  const setEmphasis = (fieldId: string, key: 'bold' | 'highlight' | 'color', value: unknown) => {
    const cur = cfgMap.get(fieldId)?.emphasis ?? {};
    const next = { ...cur } as Record<string, unknown>;
    if (key === 'color') {
      if (value) next.color = value;
      else delete next.color;
    } else if (value) {
      next[key] = true;
    } else {
      delete next[key];
    }
    const emphasis = Object.keys(next).length ? (next as FieldConfig['emphasis']) : undefined;
    patch(fieldId, { emphasis });
  };

  return (
    <section className="cfg-card">
      <div className="cfg-card-head">
        <h2>3. 字段配置</h2>
        <span className="cfg-hint">共 {list.length} 个字段</span>
      </div>
      <p className="cfg-hint">
        「必填」只对前端可编辑字段生效，提交时会校验；只读字段（公式、创建时间等）不参与必填。「可编辑」关闭后该字段在前端仅展示、置灰不可修改。
      </p>

      <div className="field-table">
        <div className="field-row field-row-head">
          <div>字段</div>
          <div>展示别名</div>
          <div>显示</div>
          <div>可编辑</div>
          <div>必填</div>
          <div>加粗</div>
          <div>字体颜色</div>
          <div>底色高亮</div>
        </div>

        {list.map((field) => {
          const cfg = cfgMap.get(field.id);
          const visible = cfg?.visible !== false;
          const typeDisabled = !field.editable || !!field.readonlyType;
          const readonlyCfg = cfg?.readonly === true;
          const editable = !typeDisabled && !readonlyCfg;
          const requiredDisabled = typeDisabled || readonlyCfg;

          return (
            <div className="field-row" key={field.id}>
              <div className="field-name-cell">
                <span className={`field-name${visible ? '' : ' dim'}`}>{field.name}</span>
                <Tag size="small" color={field.readonlyType ? 'grey' : 'light-blue'}>
                  {typeLabel(field.type)}
                </Tag>
                {field.readonlyType ? (
                  <Tag size="small" color="white">
                    只读
                  </Tag>
                ) : null}
              </div>
              <div>
                <Input
                  size="small"
                  value={cfg?.label ?? ''}
                  placeholder={field.name}
                  onChange={(v) => patch(field.id, { label: v.trim() ? v : undefined })}
                />
              </div>
              <div>
                <Checkbox
                  checked={visible}
                  onChange={(e) => patch(field.id, { visible: !!e.target.checked })}
                >
                  {null}
                </Checkbox>
              </div>
              <div>
                <Checkbox
                  checked={editable}
                  disabled={typeDisabled}
                  onChange={(e) =>
                    patch(
                      field.id,
                      e.target.checked ? { readonly: undefined } : { readonly: true, required: undefined },
                    )
                  }
                >
                  {null}
                </Checkbox>
              </div>
              <div>
                <Checkbox
                  checked={!!cfg?.required}
                  disabled={requiredDisabled}
                  onChange={(e) => patch(field.id, { required: !!e.target.checked })}
                >
                  {null}
                </Checkbox>
              </div>
              <div>
                <Checkbox
                  checked={!!cfg?.emphasis?.bold}
                  onChange={(e) => setEmphasis(field.id, 'bold', e.target.checked)}
                >
                  {null}
                </Checkbox>
              </div>
              <div>
                <Select
                  size="small"
                  value={emphasisColor(cfg)}
                  placeholder="默认"
                  onChange={(v) => setEmphasis(field.id, 'color', v)}
                  optionList={[
                    { label: '默认', value: '' },
                    ...EMPHASIS_COLORS.map((c, i) => ({
                      label: (
                        <span className="color-option">
                          <i style={{ background: c }} />
                          {['红', '橙', '绿', '蓝', '紫', '黑'][i] ?? c}
                        </span>
                      ),
                      value: c,
                    })),
                  ]}
                />
              </div>
              <div>
                <Checkbox
                  checked={!!cfg?.emphasis?.highlight}
                  onChange={(e) => setEmphasis(field.id, 'highlight', e.target.checked)}
                >
                  {null}
                </Checkbox>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}