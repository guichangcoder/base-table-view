import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, DatePicker, Empty, Input, Select, Spin, Toast } from '@douyinfe/semi-ui';
import { FieldType } from '@lark-base-open/js-sdk';
import type { FieldMetaLite, FilterItem, PluginData, RecordRow } from '../../types';
import { visibleFieldIds } from '../../utils/configOps';
import { displayCell, formatCellValue } from '../../utils/valueConverter';
import { isLinkType, isSearchableType, isUserType, loadViewMeta, listSelectOptions, type SelectOptionLite } from '../../services/baseService';
import { docReady } from '../../services/docService';
import { clearDraft, loadDraft } from '../../services/draftService';
import {
  addRecord,
  getRecordById,
  listLinkCandidates,
  listRecords,
  listUserCandidates,
  updateRecord,
  type LinkCandidate,
  type UserCandidate,
} from '../../services/recordService';
import { RecordDetail } from './RecordDetail';
import { RecordForm } from '../form/RecordForm';
import { DocForm } from '../form/DocForm';

const FT = FieldType as any;
const PAGE_SIZE = 50;
/** 前端累计展示上限：万级大表不能无限追加 DOM，超出后引导用户用筛选/搜索收窄 */
const MAX_LOADED = 1000;

/** 可用于筛选的字段类型（与配置面板、recordService.buildCondition 保持一致） */
const FILTERABLE_TYPES = [
  FT.Text,
  FT.Number,
  FT.SingleSelect,
  FT.MultiSelect,
  FT.DateTime,
  FT.User,
  FT.Phone,
  FT.Email,
  FT.Url,
  FT.Checkbox,
  FT.SingleLink,
  FT.DuplexLink,
].filter((v) => typeof v === 'number');

function isNumberType(t?: number): boolean {
  return t === FT.Number || t === FT.Currency || t === FT.Progress || t === FT.Rating;
}
function isDateType(t?: number): boolean {
  return t === FT.DateTime || t === FT.CreatedTime || t === FT.ModifiedTime;
}

function operatorsFor(type?: number): Array<{ label: string; value: FilterItem['operator'] }> {
  if (isNumberType(type) || isDateType(type)) {
    return [
      { label: '等于', value: 'is' },
      { label: '大于', value: 'isGreater' },
      { label: '小于', value: 'isLess' },
      { label: '不为空', value: 'isNotEmpty' },
    ];
  }
  if (type === FT.Checkbox) {
    // 复选框的筛选条件只允许 is + boolean，其余算非法条件
    return [{ label: '等于', value: 'is' }];
  }
  if (typeof type === 'number' && isLinkType(type)) {
    // 关联字段按关联记录筛选，SDK 只支持 contains（值为记录 id）
    return [
      { label: '包含', value: 'contains' },
      { label: '不为空', value: 'isNotEmpty' },
    ];
  }
  if (type === FT.SingleSelect || type === FT.MultiSelect || type === FT.User) {
    return [
      { label: '等于', value: 'is' },
      { label: '不为空', value: 'isNotEmpty' },
    ];
  }
  return [
    { label: '包含', value: 'contains' },
    { label: '等于', value: 'is' },
    { label: '不为空', value: 'isNotEmpty' },
  ];
}

function defaultOperator(type?: number): FilterItem['operator'] {
  if (type === FT.Checkbox) return 'is';
  if (typeof type === 'number' && isLinkType(type)) return 'contains';
  if (type === FT.SingleSelect || type === FT.MultiSelect || type === FT.User) return 'is';
  if (isNumberType(type) || isDateType(type)) return 'is';
  return 'contains';
}

interface Props {
  config: PluginData;
}

/** 浏览态：左侧筛选 + 记录列表，右侧分组详情 */
export function Workbench({ config }: Props) {
  const [fields, setFields] = useState<FieldMetaLite[]>([]);
  const [primaryId, setPrimaryId] = useState('');
  const [tableName, setTableName] = useState('');
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [records, setRecords] = useState<RecordRow[]>([]);
  const [pageToken, setPageToken] = useState<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');

  const [keyword, setKeyword] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [filterOps, setFilterOps] = useState<Record<string, FilterItem['operator']>>({});
  const [applied, setApplied] = useState<{ filters: FilterItem[]; keyword: string }>({
    filters: [],
    keyword: '',
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [userOptions, setUserOptions] = useState<Record<string, UserCandidate[]>>({});
  /** 单选/多选筛选项的原生选项（元信息可能不全，按字段补读） */
  const [selectOptions, setSelectOptions] = useState<Record<string, SelectOptionLite[]>>({});
  /** 关联字段筛选项：关联表的候选记录（按记录 id 过滤） */
  const [linkOptions, setLinkOptions] = useState<Record<string, LinkCandidate[]>>({});
  /** 排序字段 id：''=不排序；null=尚未初始化（首次自动选中创建时间） */
  const [sortFieldId, setSortFieldId] = useState<string | null>(null);
  /** true=降序（最新/最大在前） */
  const [sortDesc, setSortDesc] = useState(true);

  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<{ mode: 'create' | 'edit' } | null>(null);
  /** 主子表单据新增页（配置了单据后可用） */
  const [docOpen, setDocOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 首屏列表就绪的数据表 id：草稿恢复要等列表就绪，避免恢复结果被首屏刷新覆盖 */
  const [readyTableId, setReadyTableId] = useState('');
  /** 草稿恢复按数据表只做一次，避免筛选/刷新时反复弹出表单 */
  const restoreDoneRef = useRef('');

  // 并发护栏：请求序号用于丢弃过期响应；ids 集合用于跨页去重
  const seqRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const idsRef = useRef<Set<string>>(new Set());
  const searchHintRef = useRef(false);

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  /** 人员类字段 id：列表/详情展示时按宿主返回的展示文本（姓名）取值 */
  const userFieldIds = useMemo(() => fields.filter((f) => isUserType(f.type)).map((f) => f.id), [fields]);
  // 配置关闭「显示」的字段前端不可阅读：筛选/搜索控件（下拉会列出选项值）也不再出现
  const hiddenFieldIds = useMemo(
    () => new Set(config.fields.filter((c) => c.visible === false).map((c) => c.fieldId)),
    [config.fields],
  );
  // 未在配置面板勾选时回退到全表可用字段，避免「控件在但点了没反应」
  const effectiveFilterIds = (
    config.filterFieldIds.length
      ? config.filterFieldIds
      : fields.filter((f) => !f.unsupported && !f.isButton && FILTERABLE_TYPES.includes(f.type)).map((f) => f.id)
  ).filter((id) => !hiddenFieldIds.has(id));
  // 关键词搜索范围：所有「可见 + 可搜索」字段（文本类 + 单选/多选），
  // 不限定在配置面板勾选的前几个字段，否则关键词出现在其它字段时会搜不到记录
  const searchableFields = useMemo(
    () =>
      fields.filter(
        (f) => !f.unsupported && !f.isButton && !hiddenFieldIds.has(f.id) && isSearchableType(f.type),
      ),
    [fields, hiddenFieldIds],
  );
  const effectiveSearchIds = useMemo(() => searchableFields.map((f) => f.id), [searchableFields]);

  // 可排序字段：排除关联/附件/按钮等宿主不支持排序的类型
  const sortableFields = useMemo(
    () =>
      fields.filter(
        (f) =>
          !f.unsupported &&
          !f.isButton &&
          !isLinkType(f.type) &&
          f.type !== FT.Attachment &&
          !hiddenFieldIds.has(f.id),
      ),
    [fields, hiddenFieldIds],
  );
  /** 默认按创建时间倒序：最新创建的记录在最顶部（未手动选择排序时生效） */
  const createdFieldId = useMemo(
    () => fields.find((f) => f.type === FT.CreatedTime)?.id ?? '',
    [fields],
  );
  const activeSortFieldId = sortFieldId ?? createdFieldId;
  /** 传给宿主的排序条件：空表示不排序，用视图默认顺序 */
  const sortItems = activeSortFieldId ? [{ fieldId: activeSortFieldId, desc: sortDesc }] : [];
  const sortKey = activeSortFieldId ? `${activeSortFieldId}:${sortDesc}` : '';

  // 1) 元信息
  useEffect(() => {
    const tableId = config.tableId;
    if (!tableId) {
      setFields([]);
      return;
    }
    let alive = true;
    setMetaLoading(true);
    setMetaError('');
    loadViewMeta(tableId)
      .then((meta) => {
        if (!alive) return;
        setFields(meta.fields);
        setTableName(meta.tableName);
        setPrimaryId(meta.primaryId);
      })
      .catch((e) => {
        if (alive) setMetaError(`读取数据表结构失败：${String((e as Error)?.message ?? e)}`);
      })
      .finally(() => {
        if (alive) setMetaLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [config.tableId]);

  // 2) 筛选字段里的人员候选值
  useEffect(() => {
    if (!config.tableId) return;
    let alive = true;
    effectiveFilterIds.forEach((id) => {
      const type = fieldMap.get(id)?.type;
      if (type !== FT.User || userOptions[id]) return;
      listUserCandidates(config.tableId as string, id)
        .then((list) => {
          if (alive) setUserOptions((prev) => ({ ...prev, [id]: list }));
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tableId, effectiveFilterIds.join(','), fields]);

  // 3) 筛选字段里单选/多选的原生选项
  useEffect(() => {
    if (!config.tableId) return;
    let alive = true;
    effectiveFilterIds.forEach((id) => {
      const type = fieldMap.get(id)?.type;
      if ((type !== FT.SingleSelect && type !== FT.MultiSelect) || selectOptions[id]) return;
      listSelectOptions(config.tableId as string, id)
        .then((list) => {
          if (alive) setSelectOptions((prev) => ({ ...prev, [id]: list }));
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tableId, effectiveFilterIds.join(','), fields]);

  // 4) 筛选字段里关联字段的候选记录（关联表按首列文本展示）
  useEffect(() => {
    if (!config.tableId) return;
    let alive = true;
    effectiveFilterIds.forEach((id) => {
      const field = fieldMap.get(id);
      if (!field || !isLinkType(field.type) || !field.linkTableId || linkOptions[id]) return;
      listLinkCandidates(field.linkTableId, { limit: 200 })
        .then((list) => {
          if (alive) setLinkOptions((prev) => ({ ...prev, [id]: list }));
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tableId, effectiveFilterIds.join(','), fields]);

  const activeFilters = useMemo<FilterItem[]>(
    () =>
      effectiveFilterIds
        .filter((id) => fieldMap.has(id))
        .map((id) => ({
          fieldId: id,
          operator: filterOps[id] ?? defaultOperator(fieldMap.get(id)?.type),
          value: filterValues[id] ?? '',
        }))
        .filter((it) => it.value !== '' || it.operator === 'isNotEmpty'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveFilterIds.join(','), filterOps, filterValues, fields],
  );

  const activeKey = `${keyword}|${JSON.stringify(activeFilters)}`;

  // 5) 输入防抖后生效
  useEffect(() => {
    const timer = setTimeout(() => setApplied({ filters: activeFilters, keyword }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const fetchPage = async (reset: boolean) => {
    if (!config.tableId || !fields.length) return;
    // 「加载更多」串行化：并发点两次会拿到同一游标，产生重复数据
    if (!reset && loadingMoreRef.current) return;

    const tableId = config.tableId;
    const seq = ++seqRef.current;
    if (reset) {
      setLoading(true);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    try {
      const res = await listRecords(config.tableId, {
        pageSize: PAGE_SIZE,
        pageToken: reset ? undefined : pageToken,
        filterItems: applied.filters,
        keyword: applied.keyword,
        searchFieldIds: effectiveSearchIds,
        fields,
        sort: sortItems,
        withDisplay: true,
      });
      // 期间筛选/搜索又变了，当前响应已过期，直接丢弃
      if (seq !== seqRef.current) return;

      if (reset) idsRef.current = new Set();
      // 多用户并发增删记录会让分页游标漂移，按 recordId 去重
      const fresh = res.records.filter((r) => !idsRef.current.has(r.recordId));
      const room = Math.max(MAX_LOADED - idsRef.current.size, 0);
      const kept = fresh.slice(0, room);
      kept.forEach((r) => idsRef.current.add(r.recordId));

      setListError('');
      setRecords((prev) => (reset ? kept : [...prev, ...kept]));
      setPageToken(res.pageToken);
      setHasMore(res.hasMore && idsRef.current.size < MAX_LOADED);
      setTotal(res.total);
      if (reset) {
        setSelectedId((prev) =>
          kept.some((r) => r.recordId === prev) ? prev : kept[0]?.recordId ?? '',
        );
      }
    } catch (e) {
      if (seq === seqRef.current) setListError(String((e as Error)?.message ?? e));
    } finally {
      if (!reset) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      } else if (seq === seqRef.current) {
        setLoading(false);
        setReadyTableId(tableId);
      }
    }
  };

  // 6) 条件变化（筛选/搜索/排序）→ 重新取第一页
  useEffect(() => {
    if (!config.tableId || fields.length === 0) return;
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tableId, fields, applied, sortKey]);

  // 7) 刷新后恢复上次保存的草稿：编辑态重新选中该记录，新建态直接打开新增表单
  useEffect(() => {
    if (!config.tableId || fields.length === 0 || readyTableId !== config.tableId) return;
    if (restoreDoneRef.current === config.tableId) return;
    restoreDoneRef.current = config.tableId;
    const tableId = config.tableId;
    const draft = loadDraft(tableId);
    if (!draft) return;

    // 新增记录入口已取消：新建态草稿不再恢复，直接清理
    if (draft.mode === 'create') {
      clearDraft(tableId);
      return;
    }
    if (!draft.recordId) {
      clearDraft(tableId);
      return;
    }

    const recordId = draft.recordId;
    const openEdit = () => {
      setSelectedId(recordId);
      setForm({ mode: 'edit' });
    };
    if (records.some((r) => r.recordId === recordId)) {
      openEdit();
      return;
    }
    // 记录不在当前列表（被筛选掉或未加载到）时单独取一次
    getRecordById(tableId, recordId, userFieldIds)
      .then((row) => {
        idsRef.current.add(recordId);
        setRecords((prev) =>
          prev.some((r) => r.recordId === recordId) ? prev : [row, ...prev],
        );
        openEdit();
      })
      .catch(() => {
        // 记录已被删除：草稿失去归属，清掉避免下次继续弹出
        clearDraft(tableId);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tableId, fields, readyTableId]);

  const selected = records.find((r) => r.recordId === selectedId) ?? null;

  const titleOf = (row: RecordRow): string => {
    const field = primaryId ? fieldMap.get(primaryId) : undefined;
    const text = formatCellValue(displayCell(row, primaryId), field);
    return text || '未命名记录';
  };

  const subOf = (row: RecordRow): string => {
    const ids = config.groups
      .flatMap((g) => visibleFieldIds(config, g))
      .filter((id) => id !== primaryId && !config.links.some((l) => l.fieldId === id))
      .slice(0, 3);
    return ids
      .map((id) => {
        const f = fieldMap.get(id);
        return f ? formatCellValue(displayCell(row, id), f) : '';
      })
      .filter(Boolean)
      .join(' · ');
  };

  const refreshRecord = async (recordId: string) => {
    if (!config.tableId) return;
    try {
      const row = await getRecordById(config.tableId, recordId, userFieldIds);
      // 新增的记录同步进去重集合，避免后续「加载更多」把它重复追加一次
      idsRef.current.add(recordId);
      setRecords((prev) =>
        prev.some((r) => r.recordId === recordId)
          ? prev.map((r) => (r.recordId === recordId ? row : r))
          : [row, ...prev],
      );
      setSelectedId(recordId);
    } catch {
      void fetchPage(true);
    }
  };

  const handleSubmit = async (payload: Record<string, unknown>) => {
    if (!config.tableId || !form) return;
    setSaving(true);
    try {
      if (form.mode === 'create') {
        const newId = await addRecord(config.tableId, payload);
        clearDraft(config.tableId);
        Toast.success('记录已新增');
        setForm(null);
        await refreshRecord(newId);
      } else {
        const recordId = selected?.recordId;
        if (!recordId) {
          Toast.error('未选中记录');
          return;
        }
        await updateRecord(config.tableId, recordId, payload);
        clearDraft(config.tableId);
        Toast.success('记录已更新');
        setForm(null);
        await refreshRecord(recordId);
      }
    } catch (e) {
      Toast.error(`保存失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!config.tableId) {
    return (
      <div className="wb-empty">
        <Empty title="还没有配置数据表" description="请先进入配置面板，选择多维表格与数据表并保存" />
      </div>
    );
  }

  const filterFields = effectiveFilterIds
    .map((id) => fieldMap.get(id))
    .filter((f): f is FieldMetaLite => !!f);

  /**
   * 按钮反馈：未配置或元信息未就绪时不能静默失效，
   * 否则用户看到的是「灰色不可点 / 点了没反应」。
   */
  const toggleFilters = () => {
    if (!filterFields.length) {
      Toast.warning(
        fields.length
          ? '当前数据表没有可用于筛选的字段'
          : '筛选字段尚未加载完成，请点「刷新」后重试',
      );
      return;
    }
    setFilterOpen((v) => !v);
  };

  const onKeywordChange = (v: string) => {
    if (!effectiveSearchIds.length && v && !searchHintRef.current) {
      searchHintRef.current = true;
      Toast.warning(
        fields.length
          ? '当前数据表没有可用于关键词搜索的字段（文本、电话、邮箱、链接、单选、多选）'
          : '搜索字段尚未加载完成，请点「刷新」后重试',
      );
    }
    setKeyword(v);
  };

  const handleRefresh = () => {
    if (!fields.length) {
      Toast.warning(metaError || '正在读取数据表结构，请稍后重试');
      return;
    }
    void fetchPage(true);
  };

  /** 关联字段筛选：远程搜索关联表记录，并保留已选中的那条，避免下拉回显成记录 id */
  const searchLinkCandidates = (field: FieldMetaLite, keyword: string) => {
    if (!field.linkTableId) return;
    void listLinkCandidates(field.linkTableId, { keyword, limit: 100 })
      .then((list) =>
        setLinkOptions((prev) => {
          const cur = prev[field.id] ?? [];
          const selectedId = filterValues[field.id] ?? '';
          const keep = cur.filter((c) => c.id === selectedId);
          const seen = new Set(keep.map((c) => c.id));
          return {
            ...prev,
            [field.id]: [...keep, ...list.filter((c) => !seen.has(c.id))].slice(0, 300),
          };
        }),
      )
      .catch(() => undefined);
  };

  const renderFilterValue = (field: FieldMetaLite) => {
    const value = filterValues[field.id] ?? '';
    const op = filterOps[field.id] ?? defaultOperator(field.type);
    if (op === 'isNotEmpty') return null;

    if (field.type === FT.Checkbox) {
      return (
        <Select
          size="small"
          placeholder="请选择"
          value={value || undefined}
          style={{ width: '100%' }}
          optionList={[
            { label: '是', value: 'true' },
            { label: '否', value: 'false' },
          ]}
          onChange={(v) => setFilterValues((prev) => ({ ...prev, [field.id]: v ? String(v) : '' }))}
        />
      );
    }

    if (field.type === FT.SingleSelect || field.type === FT.MultiSelect) {
      const native = selectOptions[field.id];
      const options = native?.length ? native : field.options ?? [];
      return (
        <Select
          size="small"
          placeholder="请选择"
          value={value || undefined}
          showClear
          filter
          style={{ width: '100%' }}
          optionList={options.map((o) => ({ label: o.name, value: o.id }))}
          onChange={(v) => setFilterValues((prev) => ({ ...prev, [field.id]: v ? String(v) : '' }))}
        />
      );
    }

    if (field.type === FT.User) {
      const options = userOptions[field.id] ?? [];
      return (
        <Select
          size="small"
          placeholder={options.length ? '请选择人员' : '读取人员…'}
          value={value || undefined}
          showClear
          filter
          style={{ width: '100%' }}
          optionList={options.map((u) => ({ label: u.name, value: u.id }))}
          onChange={(v) => setFilterValues((prev) => ({ ...prev, [field.id]: v ? String(v) : '' }))}
        />
      );
    }

    if (isLinkType(field.type)) {
      const options = linkOptions[field.id] ?? [];
      return (
        <Select
          size="small"
          placeholder={options.length ? '请选择关联记录' : '读取关联记录…'}
          value={value || undefined}
          showClear
          filter
          remote
          style={{ width: '100%' }}
          optionList={options.map((c) => ({ label: c.name || '（未命名记录）', value: c.id }))}
          onSearch={(kw) => searchLinkCandidates(field, kw)}
          onChange={(v) => setFilterValues((prev) => ({ ...prev, [field.id]: v ? String(v) : '' }))}
        />
      );
    }

    if (isDateType(field.type)) {
      const ms = Number(value);
      return (
        <DatePicker
          size="small"
          type="date"
          style={{ width: '100%' }}
          value={Number.isFinite(ms) && ms ? new Date(ms) : undefined}
          onChange={(d: any) =>
            setFilterValues((prev) => ({
              ...prev,
              [field.id]: d instanceof Date ? String(d.getTime()) : '',
            }))
          }
        />
      );
    }

    return (
      <Input
        size="small"
        placeholder={isNumberType(field.type) ? '输入数字' : '输入关键词'}
        value={value}
        onChange={(v) => setFilterValues((prev) => ({ ...prev, [field.id]: v }))}
      />
    );
  };

  return (
    <div className="wb">
      <aside className="wb-side">
        <div className="wb-side-head">
          <div className="wb-title">{tableName || '记录列表'}</div>
          <div className="wb-sub">
            {typeof total === 'number' ? `共 ${total} 条` : `已加载 ${records.length} 条`}
          </div>
        </div>

        <div className="wb-toolbar">
          <Input
            placeholder={effectiveSearchIds.length ? '搜索关键词' : '当前数据表没有可搜索的字段'}
            value={keyword}
            showClear
            onChange={onKeywordChange}
          />
          <Button
            theme={filterOpen ? 'solid' : 'light'}
            type={filterOpen ? 'primary' : 'tertiary'}
            onClick={toggleFilters}
          >
            筛选{activeFilters.length ? ` ${activeFilters.length}` : ''}
          </Button>
        </div>

        <div className="wb-toolbar wb-toolbar-sort">
          <span className="wb-sort-label">排序</span>
          <Select
            size="small"
            value={activeSortFieldId}
            showClear={false}
            filter
            placeholder="选择排序字段"
            onChange={(v) => setSortFieldId(String(v ?? ''))}
            optionList={[
              { label: '不排序（视图默认）', value: '' },
              ...sortableFields.map((f) => ({ label: f.name, value: f.id })),
            ]}
          />
          <Button
            size="small"
            disabled={!activeSortFieldId}
            title={sortDesc ? '当前：降序（新→旧 / 大→小）' : '当前：升序（旧→新 / 小→大）'}
            onClick={() => setSortDesc((v) => !v)}
          >
            {sortDesc ? '↓ 降序' : '↑ 升序'}
          </Button>
        </div>

        {filterOpen && filterFields.length ? (
          <div className="wb-filters">
            {filterFields.map((field) => {
              const op = filterOps[field.id] ?? defaultOperator(field.type);
              return (
                <div className="filter-row" key={field.id}>
                  <div className="filter-name">{field.name}</div>
                  <div className="filter-controls">
                    <Select
                      size="small"
                      value={op}
                      style={{ width: 96 }}
                      optionList={operatorsFor(field.type)}
                      onChange={(v) =>
                        setFilterOps((prev) => ({ ...prev, [field.id]: v as FilterItem['operator'] }))
                      }
                    />
                    {renderFilterValue(field)}
                  </div>
                </div>
              );
            })}
            <Button
              size="small"
              theme="borderless"
              onClick={() => {
                setFilterValues({});
                setFilterOps({});
              }}
            >
              清空筛选
            </Button>
          </div>
        ) : null}

        {metaError ? <Banner type="danger" description={metaError} closeIcon={null} /> : null}
        {listError ? <Banner type="danger" description={listError} closeIcon={null} /> : null}

        <div className="wb-list">
          {metaLoading || (loading && records.length === 0) ? (
            <div className="wb-list-loading">
              <Spin />
            </div>
          ) : records.length === 0 ? (
            <Empty title="没有符合条件的记录" description="调整筛选条件或新增一条记录" />
          ) : (
            records.map((row) => (
              <button
                type="button"
                key={row.recordId}
                className={`record-item${row.recordId === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(row.recordId)}
              >
                <div className="record-title">{titleOf(row)}</div>
                <div className="record-sub">{subOf(row) || '—'}</div>
              </button>
            ))
          )}
        </div>

        {hasMore ? (
          <div className="wb-more">
            <Button loading={loadingMore} disabled={loadingMore} onClick={() => fetchPage(false)}>
              加载更多
            </Button>
          </div>
        ) : records.length >= MAX_LOADED ? (
          <div className="wb-more-tip">
            已加载前 {MAX_LOADED} 条，请用筛选或关键词搜索收窄范围
          </div>
        ) : null}
      </aside>

      <main className="wb-main">
        <div className="wb-main-head">
          <div className="wb-main-title">
            <h2>{selected ? titleOf(selected) : '记录详情'}</h2>
          </div>
          <div className="wb-main-actions">
            <Button theme="borderless" onClick={handleRefresh} loading={loading}>
              刷新
            </Button>
            {selected ? (
              <Button onClick={() => setForm({ mode: 'edit' })}>编辑</Button>
            ) : null}
            {docReady(config.doc) ? (
              <Button theme="solid" type="primary" onClick={() => setDocOpen(true)}>
                新增{config.doc?.name?.trim() || '单据'}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="wb-detail">
          <RecordDetail config={config} fields={fields} record={selected} />
        </div>
      </main>

      <RecordForm
        open={!!form}
        mode={form?.mode ?? 'create'}
        config={config}
        fields={fields}
        record={form?.mode === 'edit' ? selected : null}
        saving={saving}
        onCancel={() => setForm(null)}
        onSubmit={handleSubmit}
      />

      {config.doc?.enabled ? (
        <DocForm
          open={docOpen}
          config={config}
          fields={fields}
          onCancel={() => setDocOpen(false)}
          onSaved={(msg) => {
            Toast.success(msg);
            setDocOpen(false);
            void fetchPage(true);
          }}
        />
      ) : null}
    </div>
  );
}