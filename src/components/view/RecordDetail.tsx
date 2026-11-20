import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Empty, Spin } from '@douyinfe/semi-ui';
import type { DocSubConfig, FieldMetaLite, PluginData, RecordRow } from '../../types';
import { isButtonField, visibleFieldIds } from '../../utils/configOps';
import { formatCellValue } from '../../utils/valueConverter';
import { hexToRgba, toneOf } from '../../utils/palette';
import { fieldLabel } from '../../utils/validator';
import { loadViewMeta } from '../../services/baseService';
import { listRecords } from '../../services/recordService';
import { RecordButton } from './RecordButton';

interface Props {
  config: PluginData;
  fields: FieldMetaLite[];
  record: RecordRow | null;
}

/** 单据子表：以只读横向表格展示当前记录关联的子表记录 */
function SubTableBlock({ sub, recordId }: { sub: DocSubConfig; recordId: string }) {
  const [cols, setCols] = useState<FieldMetaLite[]>([]);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [tableName, setTableName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loadViewMeta(sub.tableId)
      .then(async (meta) => {
        if (!alive) return;
        setTableName(meta.tableName);
        const usable = meta.fields.filter(
          (f) => !f.unsupported && !f.isButton && f.id !== sub.linkFieldId,
        );
        const res = await listRecords(sub.tableId, {
          pageSize: 200,
          filterItems: [{ fieldId: sub.linkFieldId, operator: 'contains', value: recordId }],
          fields: meta.fields,
        });
        if (!alive) return;
        setCols(usable);
        setRows(res.records);
      })
      .catch((e) => {
        if (alive) setError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sub.tableId, sub.linkFieldId, recordId]);

  return (
    <section className="doc-sub">
      <div className="doc-sub-head-bar">
        <h4>{tableName || '子表记录'}</h4>
        <span className="cfg-hint">{rows.length} 条</span>
      </div>

      {loading ? (
        <div className="link-block-loading">
          <Spin size="small" />
        </div>
      ) : error ? (
        <div className="link-block-empty">子表读取失败：{error}</div>
      ) : rows.length === 0 ? (
        <div className="link-block-empty">暂无子表记录</div>
      ) : (
        <div className="sub-table-wrap">
          <table className="sub-table doc-sub-table">
            <thead>
              <tr>
                <th className="sub-col-index">#</th>
                {cols.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.recordId}>
                  <td className="sub-col-index">{i + 1}</td>
                  {cols.map((c) => {
                    const text = formatCellValue(row.fields[c.id], c);
                    return (
                      <td key={c.id} title={text}>
                        {text || '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function valueStyle(emphasis: { bold?: boolean; color?: string } | undefined): CSSProperties {
  const style: CSSProperties = {};
  if (emphasis?.bold) style.fontWeight = 600;
  if (emphasis?.color) style.color = emphasis.color;
  return style;
}

/** 单条记录的详情：主表字段按配置分组只读展示，子表以横向表格展示一次 */
export function RecordDetail({ config, fields, record }: Props) {
  if (!record) {
    return (
      <div className="detail-empty">
        <Empty title="选择左侧记录查看详情" description="或者点击「新增记录」录入一条新数据" />
      </div>
    );
  }

  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const cfgMap = new Map(config.fields.map((c) => [c.fieldId, c]));
  const linkMap = new Map(config.links.map((l) => [l.fieldId, l]));

  // 单据配置的子表：浏览态统一以横向表格展示（与新增单据页一致）
  const subs = config.doc?.enabled
    ? (config.doc.subs ?? []).filter((s) => s.tableId && s.linkFieldId)
    : [];
  const subTableIds = new Set(subs.map((s) => s.tableId));

  const blocks = config.groups
    .map((group) => {
      const ids = visibleFieldIds(config, group)
        .filter((id) => fieldMap.has(id))
        // 已由下方 doc-sub 表格展示的子表，其关联字段不在字段网格里重复出现
        .filter((id) => {
          const link = linkMap.get(id);
          return !link || !subTableIds.has(link.tableId);
        });
      return { group, ids, count: ids.length };
    })
    .filter((b) => b.count > 0);

  if (!blocks.length && !subs.length) {
    return (
      <div className="detail-empty">
        <Empty title="还没有配置展示字段" description="请在配置面板中把字段加入分组并保存" />
      </div>
    );
  }

  return (
    <div className="detail">
      {blocks.map(({ group, ids }) => {
        const tone = toneOf(group.color);
        return (
          <section
            className="group-block"
            key={group.id}
            style={{ background: tone.bg, borderColor: tone.border }}
          >
            <header className="group-block-head">
              <i className="group-block-bar" style={{ background: tone.color }} />
              <h3 style={{ color: tone.color }}>{group.name}</h3>
              <span className="group-block-count">{ids.length} 个字段</span>
            </header>

            <div className={`field-grid cols-${group.columns}`}>
              {ids.map((id) => {
                const field = fieldMap.get(id);
                if (!field) return null;
                const cfg = cfgMap.get(id);
                const text = formatCellValue(record.fields[id], field);
                const highlight = cfg?.emphasis?.highlight;
                const hlColor = cfg?.emphasis?.color ?? group.color;
                return (
                  <div className="field-item" key={id}>
                    <div className="field-label">
                      {fieldLabel(field, cfg)}
                      {cfg?.required ? <i className="field-required">*</i> : null}
                    </div>
                    {isButtonField(field, cfg) ? (
                      <RecordButton
                        tableId={config.tableId}
                        recordId={record.recordId}
                        field={field}
                        title={cfg?.label || field.buttonTitle || field.name}
                        webhookUrl={cfg?.webhookUrl}
                      />
                    ) : (
                      <div
                        className={`field-value${text ? '' : ' empty'}`}
                        style={{
                          ...valueStyle(cfg?.emphasis),
                          ...(highlight ? { background: hexToRgba(hlColor, 0.14) } : null),
                        }}
                      >
                        {text || '—'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {subs.map((sub) => (
        <SubTableBlock key={`${sub.tableId}:${sub.linkFieldId}`} sub={sub} recordId={record.recordId} />
      ))}
    </div>
  );
}