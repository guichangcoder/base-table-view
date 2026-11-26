import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Tag, TextArea, Toast } from '@douyinfe/semi-ui';
import type { ButtonHttpConfig, FieldMetaLite, HttpBodyFormat, HttpPair } from '../../types';

/**
 * 按钮动作配置弹窗：对齐数据表工作流「发送 HTTP 请求」节点。
 *
 * 只配置真正参与请求的内容（方法 / 地址 / 参数 / 请求头 / 请求体），
 * 浏览器环境下的响应读取受跨域限制，故响应处理只做说明、不提供配置项。
 */

const METHODS = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE'];

const BODY_FORMATS: Array<{ label: string; value: HttpBodyFormat }> = [
  { label: 'JSON', value: 'json' },
  { label: 'x-www-form-urlencoded', value: 'urlencoded' },
  { label: '纯文本', value: 'text' },
];

const BODY_PLACEHOLDER: Record<HttpBodyFormat, string> = {
  json: '{\n  "name": "{{姓名}}",\n  "phone": "{{电话}}"\n}',
  urlencoded: 'name={{姓名}}&phone={{电话}}',
  text: '{{姓名}} {{电话}}',
};

/** 请求参数值的默认动态占位符：点击按钮时取当前记录 id */
const RECORD_ID_TOKEN = '{{记录ID}}';

/** 请求参数默认值：一条空键 + 动态记录 id */
function defaultParams(): HttpPair[] {
  return [{ k: '', v: RECORD_ID_TOKEN }];
}

function emptyDraft(): ButtonHttpConfig {
  return {
    method: 'POST',
    url: '',
    params: defaultParams(),
    headers: [{ k: '', v: '' }],
    bodyMode: 'auto',
    bodyFormat: 'json',
    body: '',
  };
}

function withDraft(value?: ButtonHttpConfig): ButtonHttpConfig {
  const base = emptyDraft();
  if (!value) return base;
  const savedParams: HttpPair[] = value.params ?? [];
  const params = savedParams.length ? savedParams : defaultParams();
  // 旧配置里可能留着全部空白的参数行：升级成默认的 {{记录ID}}
  const blankParams = params.every((p) => !p.k.trim() && !p.v.trim());
  return {
    ...base,
    ...value,
    params: blankParams ? defaultParams() : params,
    headers: value.headers?.length ? value.headers : base.headers,
  };
}

interface PairEditorProps {
  pairs: HttpPair[];
  onChange: (next: HttpPair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  /** 新增行的默认值（请求参数默认填入 {{记录ID}}） */
  newRowValue?: string;
  disabled?: boolean;
}

/** 键值对编辑器（Params / Headers 共用） */
function PairEditor({ pairs, onChange, keyPlaceholder, valuePlaceholder, newRowValue = '', disabled }: PairEditorProps) {
  const rows = pairs.length ? pairs : [{ k: '', v: newRowValue }];
  const setRow = (i: number, patch: Partial<HttpPair>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  return (
    <div className="kv-editor">
      {rows.map((row, i) => (
        <div className="kv-row" key={i}>
          <Input
            size="small"
            value={row.k}
            disabled={disabled}
            placeholder={keyPlaceholder}
            onChange={(v) => setRow(i, { k: v })}
          />
          <span className="kv-sep">:</span>
          <Input
            size="small"
            value={row.v}
            disabled={disabled}
            placeholder={valuePlaceholder}
            onChange={(v) => setRow(i, { v: v })}
          />
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            disabled={disabled || rows.length === 1}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        size="small"
        theme="borderless"
        type="primary"
        disabled={disabled}
        onClick={() => onChange([...rows, { k: '', v: newRowValue }])}
      >
        + 添加
      </Button>
    </div>
  );
}

interface Props {
  visible: boolean;
  /** 当前配置的字段（按钮字段） */
  field: FieldMetaLite;
  /** 已有配置，undefined 表示尚未配置 */
  value?: ButtonHttpConfig;
  /** 全部字段，用于提示可插入的占位符 */
  fields: FieldMetaLite[];
  onCancel: () => void;
  /** undefined 表示清除该按钮的动作配置 */
  onOk: (next: ButtonHttpConfig | undefined) => void;
}

export function ButtonActionDialog({ visible, field, value, fields, onCancel, onOk }: Props) {
  const [draft, setDraft] = useState<ButtonHttpConfig>(() => withDraft(value));

  // 每次打开都以最新的已保存配置为准，避免上次取消留下的草稿
  useEffect(() => {
    if (visible) setDraft(withDraft(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const patch = (p: Partial<ButtonHttpConfig>) => setDraft((cur) => ({ ...cur, ...p }));

  const submit = () => {
    const url = draft.url.trim();
    if (!url) {
      const hasOther =
        draft.bodyMode === 'template' ||
        (draft.params ?? []).some((p) => p.k.trim()) ||
        (draft.headers ?? []).some((p) => p.k.trim());
      if (hasOther) {
        Toast.error('请填写请求地址（URL）');
        return;
      }
      onOk(undefined);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      Toast.error('请求地址需以 http:// 或 https:// 开头');
      return;
    }
    onOk(draft);
  };

  const bodyDisabled = draft.method === 'GET';
  const tokens = fields.filter((f) => !f.isButton);

  return (
    <Modal
      title={`按钮动作配置${field.buttonTitle || field.name ? ` · ${field.buttonTitle || field.name}` : ''}`}
      visible={visible}
      width={680}
      onCancel={onCancel}
      onOk={submit}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
      footer={
        <div className="btn-action-footer">
          <Button theme="borderless" type="danger" onClick={() => onOk(undefined)}>
            清除配置
          </Button>
          <div className="btn-action-footer-right">
            <Button onClick={onCancel}>取消</Button>
            <Button theme="solid" type="primary" onClick={submit}>
              确定
            </Button>
          </div>
        </div>
      }
    >
      <div className="btn-action">
        <div className="btn-action-block">
          <div className="btn-action-label">请求方法</div>
          <Select
            value={draft.method}
            optionList={METHODS.map((m) => ({ label: m, value: m }))}
            onChange={(v) => patch({ method: String(v) })}
          />
        </div>

        <div className="btn-action-block">
          <div className="btn-action-label">
            请求地址（URL）<i className="field-required">*</i>
          </div>
          <Input
            value={draft.url}
            placeholder="https://example.com/api/hook"
            onChange={(v) => patch({ url: v })}
          />
          <div className="btn-action-tip">
            数据表工作流「发送 HTTP 请求」节点的地址可直接粘贴；
            自动化「接收到 webhook 时」的唯一地址也可粘贴。
          </div>
        </div>

        <div className="btn-action-block">
          <div className="btn-action-label">请求参数（Params）</div>
          <PairEditor
            pairs={draft.params ?? []}
            keyPlaceholder="键"
            valuePlaceholder="值"
            newRowValue={RECORD_ID_TOKEN}
            onChange={(next) => patch({ params: next })}
          />
          <div className="btn-action-tip">
            值支持动态占位符：{RECORD_ID_TOKEN} 取当前记录 id（新增参数行默认填入），
            {'{{字段名}}'} 或 {'{{字段别名}}'} 取本条记录字段值；未匹配的占位符原样保留。
            该 id 是主表中该行真实的 record ID，未保存的新记录没有 id，按钮会置灰不可点击。
          </div>
        </div>

        <div className="btn-action-block">
          <div className="btn-action-label">请求头（Headers）</div>
          <PairEditor
            pairs={draft.headers ?? []}
            keyPlaceholder="键"
            valuePlaceholder="值"
            onChange={(next) => patch({ headers: next })}
          />
          <div className="btn-action-tip">
            值同样支持 {RECORD_ID_TOKEN}、{'{{字段名}}'} 等占位符。
            Content-Type 已按请求体格式自动设置，无需手填。自定义请求头会触发跨域预检，
            目标服务必须允许跨域，否则浏览器会拦截该请求。
          </div>
        </div>

        <div className="btn-action-block">
          <div className="btn-action-label">请求体（Request body）</div>
          <div className="btn-action-inline">
            <Select
              value={draft.bodyMode}
              disabled={bodyDisabled}
              optionList={[
                { label: '自动发送全部字段', value: 'auto' },
                { label: '自定义模板', value: 'template' },
              ]}
              onChange={(v) => patch({ bodyMode: v as ButtonHttpConfig['bodyMode'] })}
            />
            {draft.bodyMode === 'template' ? (
              <Select
                value={draft.bodyFormat ?? 'json'}
                disabled={bodyDisabled}
                optionList={BODY_FORMATS}
                onChange={(v) => patch({ bodyFormat: v as HttpBodyFormat })}
              />
            ) : null}
          </div>

          {bodyDisabled ? (
            <div className="btn-action-tip">GET 请求不发送请求体。</div>
          ) : draft.bodyMode === 'auto' ? (
            <div className="btn-action-tip">
              以 JSON 发送本记录的全部字段：fields 为字段名到文本值，raw 为人员、附件类字段的原始结构
              （附件含 token 与临时下载链接）。
            </div>
          ) : (
            <>
              <TextArea
                value={draft.body ?? ''}
                rows={6}
                placeholder={BODY_PLACEHOLDER[draft.bodyFormat ?? 'json']}
                onChange={(v) => patch({ body: v })}
              />
              <div className="btn-action-tokens">
                <span className="btn-action-tip">插入字段：</span>
                {tokens.map((f) => (
                  <Tag
                    key={f.id}
                    size="small"
                    color="light-blue"
                    style={{ cursor: 'pointer' }}
                    onClick={() => patch({ body: `${draft.body ?? ''}{{${f.name}}}` })}
                  >
                    {f.name}
                  </Tag>
                ))}
              </div>
              <div className="btn-action-tip">
                用 {'{{字段名}}'} 引用本条记录的值，未匹配的占位符会原样保留。
              </div>
            </>
          )}
        </div>

        <div className="btn-action-block">
          <div className="btn-action-label">响应配置</div>
          <div className="btn-action-tip">
            浏览器受跨域限制：目标地址允许跨域时可读取响应状态；不允许时请求仍会发出，
            但插件读不到响应内容，只能提示「已发送」。因此不需要在此配置响应解析，
            响应处理请在接收请求的服务或工作流中完成。
          </div>
        </div>
      </div>
    </Modal>
  );
}
