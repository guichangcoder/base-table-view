import { useEffect, useState } from 'react';
import { Spin, Tag } from '@douyinfe/semi-ui';
import type { FieldMetaLite, LinkDisplayConfig, RecordRow } from '../../types';
import { getRecordsByIds, extractLinkIds } from '../../services/recordService';
import { listFieldsCached } from '../../services/baseService';
import { formatCellValue } from '../../utils/valueConverter';

interface Props {
  link: LinkDisplayConfig;
  /** 关联字段的单元格值 */
  value: unknown;
  fieldName: string;
}

/**
 * 关联字段的纵向展开：以表格形式列出关联记录，而不是标签页。
 * 一期只读。
 */
export function LinkBlock({ link, value, fieldName }: Props) {
  const ids = extractLinkIds(value);
  const idsKey = ids.join(',');
  const displayKey = link.displayFieldIds.join(',');

  const [cols, setCols] = useState<FieldMetaLite[]>([]);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!idsKey) {
      setRows([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    const wanted = ids.slice(0, Math.max(link.maxRows, 1));

    Promise.all([listFieldsCached(link.tableId), getRecordsByIds(link.tableId, wanted)])
      .then(([allFields, records]) => {
        if (!alive) return;
        const usable = allFields.filter((f) => !f.unsupported);
        const picked = link.displayFieldIds.length
          ? usable.filter((f) => link.displayFieldIds.includes(f.id))
          : usable.slice(0, 1);
        setCols(picked.length ? picked : usable.slice(0, 1));
        setRows(records);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, displayKey, link.tableId, link.maxRows]);

  const truncated = ids.length > link.maxRows;

  return (
    <div className="link-block">
      <div className="link-block-head">
        <span className="link-block-name">{fieldName}</span>
        <Tag size="small" color="blue">
          {ids.length} 条
        </Tag>
        {truncated ? <span className="link-block-tip">仅展示前 {link.maxRows} 条</span> : null}
      </div>

      {loading ? (
        <div className="link-block-loading">
          <Spin size="small" />
        </div>
      ) : error ? (
        <div className="link-block-empty">关联记录读取失败：{error}</div>
      ) : ids.length === 0 ? (
        <div className="link-block-empty">无关联记录</div>
      ) : (
        <div className="link-table-wrap">
          <table className="link-table">
            <thead>
              <tr>
                <th className="link-col-index">#</th>
                {cols.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.recordId}>
                  <td className="link-col-index">{i + 1}</td>
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
    </div>
  );
}