import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@douyinfe/semi-ui';
import { listLinkCandidates, type LinkCandidate } from '../../services/recordService';

interface Props {
  /** 关联表 id */
  tableId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** 单选模式：用于「合同」这类单值关联字段 */
  single?: boolean;
}

const SEARCH_DEBOUNCE = 300;
const OPTION_LIMIT = 50;
/** 关联记录取不到首列文本时的展示占位，任何情况下都不向用户暴露记录 ID */
const FALLBACK_LABEL = '未命名记录';

/**
 * 关联字段编辑器：候选记录取自关联表首列，支持远程搜索。
 * 已选记录即使不在当前候选里也会保留标题，避免编辑态回显丢失。
 */
export function LinkFieldSelect({ tableId, value, onChange, disabled, single }: Props) {
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  /** 候选与已知标题一起更新：搜索结果被替换后，已选项仍能显示标题 */
  const updateCandidates = (list: LinkCandidate[]) => {
    setCandidates(list);
    setLabels((prev) => {
      const next = { ...prev };
      list.forEach((c) => {
        next[c.id] = c.name || FALLBACK_LABEL;
      });
      return next;
    });
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  // 打开表单：先拉一批候选
  useEffect(() => {
    if (!tableId) return;
    let active = true;
    setLoading(true);
    listLinkCandidates(tableId, { limit: OPTION_LIMIT })
      .then((list) => {
        if (active && alive.current) updateCandidates(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tableId]);

  // 已选记录标题回显：值来源可能是编辑态、草稿或前一次打开的表单
  const selectedKey = value.join(',');
  useEffect(() => {
    if (!tableId) return;
    const known = new Set(candidates.map((c) => c.id));
    const missing = selectedKey ? selectedKey.split(',').filter((id) => id && !known.has(id) && !labels[id]) : [];
    if (!missing.length) return;
    let active = true;
    listLinkCandidates(tableId, { recordIds: missing })
      .then((list) => {
        if (!active || !alive.current || !list.length) return;
        setLabels((prev) => {
          const next = { ...prev };
          list.forEach((c) => {
            next[c.id] = c.name || FALLBACK_LABEL;
          });
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // candidates / labels 仅用于跳过已缓存项，变化时无需重新拉取已选标题
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, selectedKey]);

  const options = useMemo(() => {
    const map = new Map<string, string>();
    candidates.forEach((c) => map.set(c.id, c.name || FALLBACK_LABEL));
    Object.entries(labels).forEach(([id, name]) => {
      if (!map.has(id)) map.set(id, name || FALLBACK_LABEL);
    });
    value.forEach((id) => {
      if (!map.has(id)) map.set(id, FALLBACK_LABEL);
    });
    return Array.from(map, ([id, name]) => ({ value: id, label: name }));
  }, [candidates, labels, value]);

  const handleSearch = (keyword: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setLoading(true);
      listLinkCandidates(tableId, { keyword, limit: OPTION_LIMIT })
        .then((list) => {
          if (alive.current) updateCandidates(list);
        })
        .catch(() => undefined)
        .finally(() => {
          if (alive.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE);
  };

  return (
    <Select
      multiple={!single}
      remote
      filter
      showClear
      maxTagCount={single ? undefined : 4}
      style={{ width: '100%' }}
      disabled={disabled}
      loading={loading}
      value={single ? value[0] ?? '' : value}
      placeholder="搜索并选择关联记录"
      optionList={options}
      onSearch={handleSearch}
      onChange={(v) => {
        if (single) onChange(v === undefined || v === null || v === '' ? [] : [String(v)]);
        else onChange(Array.isArray(v) ? v.map(String) : []);
      }}
    />
  );
}
