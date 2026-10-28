import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Spin, Empty, Tag, Toast } from '@douyinfe/semi-ui';
import { isWorkspaceAvailable, listBases } from '../../services/appContext';

interface BaseItem {
  name: string;
  token: string;
}

interface Props {
  baseToken: string;
  baseName: string;
  onSelect: (token: string, name: string) => void;
}

/**
 * 可搜索、可分页的多维表格选择器（Workspace.getBaseList）。
 * 只有选中后才 getBitable，符合「Workspace 唯一入口」契约。
 */
export function BasePicker({ baseToken, baseName, onSelect }: Props) {
  const [items, setItems] = useState<BaseItem[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const fetchPage = useCallback(
    async (reset: boolean, keyword: string) => {
      if (!isWorkspaceAvailable()) {
        Toast.error('当前环境不支持选择多维表格，请在飞书内打开');
        return;
      }
      setLoading(true);
      try {
        const res: any = await listBases(keyword || undefined, reset ? undefined : cursor || undefined);
        const list: BaseItem[] = (res?.base_list ?? []).map((b: any) => ({
          name: String(b.name ?? b.token),
          token: String(b.token),
        }));
        setItems((prev) => (reset ? list : [...prev, ...list]));
        setCursor(String(res?.page?.cursor ?? ''));
        setHasMore(!!res?.page?.hasMore);
      } catch (e) {
        console.warn('[BasePicker] getBaseList 失败:', e);
        Toast.error('读取多维表格列表失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [cursor],
  );

  useEffect(() => {
    void fetchPage(true, '');
    // 只在首次挂载时拉第一页
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="base-picker">
      <div className="base-current">
        <span className="label">当前多维表格</span>
        {baseToken ? (
          <Tag color="blue" size="large">
            {baseName || baseToken.slice(-8)}
          </Tag>
        ) : (
          <Tag color="grey" size="large">
            未选择
          </Tag>
        )}
      </div>

      <div className="base-search">
        <Input
          placeholder="搜索多维表格名称"
          value={query}
          onChange={setQuery}
          onEnterPress={() => fetchPage(true, query.trim())}
          showClear
        />
        <Button onClick={() => fetchPage(true, query.trim())} loading={loading}>
          搜索
        </Button>
      </div>

      <div className="base-list">
        {loading && items.length === 0 ? (
          <div className="base-loading">
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty title="没有找到可用的多维表格" />
        ) : (
          items.map((b) => (
            <button
              type="button"
              key={b.token}
              className={`base-item${b.token === baseToken ? ' active' : ''}`}
              onClick={() => onSelect(b.token, b.name)}
            >
              <span className="base-item-name">{b.name}</span>
              <span className="base-item-token">…{b.token.slice(-6)}</span>
            </button>
          ))
        )}
      </div>

      {hasMore ? (
        <Button theme="borderless" onClick={() => fetchPage(false, query.trim())} loading={loading}>
          加载更多
        </Button>
      ) : null}
    </div>
  );
}