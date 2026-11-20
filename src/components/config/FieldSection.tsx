import { useState } from 'react';
import { Button, Checkbox, Input, Select, Tag } from '@douyinfe/semi-ui';
import type { FieldConfig, FieldMetaLite, PluginData } from '../../types';
import { setFieldConfig, isButtonField } from '../../utils/configOps';
import { EMPHASIS_COLORS } from '../../utils/palette';
import { FieldType } from '@lark-base-open/js-sdk';
import { BUTTON_TYPE } from '../../services/baseService';
import { ButtonActionDialog } from './ButtonActionDialog';

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
  [BUTTON_TYPE]: '按钮',
};

export function typeLabel(type: number): string {
  const label = TYPE_LABEL[type];
  if (label) return label;
  // 未建模的类型把原始类型值带出来，便于排查（如「其他(3001)」）
  return Number.isFinite(type) ? `其他(${type})` : '其他';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingField = editingId ? list.find((f) => f.id === editingId) : undefined;

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
        <br />
        字段名后的类型标签可点击：切成「按钮」表示该字段在前端渲染成按钮（用于数据表里的按钮字段），再点一下恢复按普通字段展示。
        <br />
        按钮字段可在最后一列点「配置」打开「按钮动作配置」弹窗：请求方法、请求地址、请求参数、请求头、请求体都可配置，形式对齐数据表工作流里的「发送 HTTP 请求」节点。
        <br />
        请求体默认「自动发送全部字段」：把本记录的全部字段值以 JSON 的 fields 发出，人员、附件类字段另外在 raw 里带上原始结构（附件含 token 和临时下载链接 url），与旧版行为一致；也可改为「自定义模板」，用 {'{{字段名}}'} 引用本条记录的任意字段。
        <br />
        浏览器限制：自定义请求头会触发跨域预检，目标服务必须允许跨域；工作流/自动化请勿开启「凭证校验」和「IP 白名单」，否则浏览器发出的请求无法通过校验。
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
          <div>按钮动作</div>
        </div>

        {list.map((field) => {
          const cfg = cfgMap.get(field.id);
          const visible = cfg?.visible !== false;
          const typeDisabled = !field.editable || !!field.readonlyType;
          const readonlyCfg = cfg?.readonly === true;
          const editable = !typeDisabled && !readonlyCfg;
          const requiredDisabled = typeDisabled || readonlyCfg;
          const isBtn = isButtonField(field, cfg);

          return (
            <div className="field-row" key={field.id}>
              <div className="field-name-cell">
                <span className={`field-name${visible ? '' : ' dim'}`}>{field.name}</span>
                <Tag
                  size="small"
                  color={isBtn ? 'blue' : field.readonlyType ? 'grey' : 'light-blue'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => patch(field.id, { asButton: isBtn ? false : true })}
                >
                  {isBtn ? '按钮' : typeLabel(field.type)}
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
              <div>
                {isBtn ? (
                  <Button
                    size="small"
                    theme={cfg?.http?.url ? 'light' : 'borderless'}
                    type="primary"
                    onClick={() => setEditingId(field.id)}
                  >
                    {cfg?.http?.url ? `已配置 ${cfg.http.method}` : '配置'}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {editingField ? (
        <ButtonActionDialog
          visible
          field={editingField}
          value={cfgMap.get(editingField.id)?.http}
          fields={list}
          onCancel={() => setEditingId(null)}
          onOk={(next) => {
            patch(editingField.id, { http: next });
            setEditingId(null);
          }}
        />
      ) : null}
    </section>
  );
}