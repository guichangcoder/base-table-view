import { useEffect, useState } from 'react';
import { Banner, Button, Modal, Select, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { emptyConfig, type FieldMetaLite, type PluginData, type TableMetaLite } from '../../types';
import { getBase, getBaseName, getBaseToken, selectBase } from '../../services/appContext';
import { listFields, listTables } from '../../services/baseService';
import { saveConfig, type ConfigSource } from '../../services/configService';
import { syncConfig } from '../../utils/configOps';
import { BasePicker } from './BasePicker';
import { SettingsSection } from './SettingsSection';
import { GroupSection } from './GroupSection';
import { FieldSection } from './FieldSection';
import { LinkSection } from './LinkSection';

interface Props {
  initial: PluginData;
  source: ConfigSource;
  droppedForeign: boolean;
  onSaved: () => void;
}

const SOURCE_LABEL: Record<ConfigSource, string> = {
  dashboard: '已保存的配置',
  bridge: '本地备份配置',
  local: '本地缓存配置',
  none: '新建配置',
};

/** 配置态：选 Base / 选表 / 分组布局 / 字段规则 / 关联展示 */
export function ConfigPanel({ initial, source, droppedForeign, onSaved }: Props) {
  const [config, setConfig] = useState<PluginData>(initial);
  const [baseToken, setBaseToken] = useState(getBaseToken());
  const [baseName, setBaseName] = useState(getBaseName());
  const [tables, setTables] = useState<TableMetaLite[]>([]);
  const [fields, setFields] = useState<FieldMetaLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 已绑定 base 但不知道名字时补一次（用于顶部展示）
  useEffect(() => {
    if (baseName || !baseToken) return;
    let alive = true;
    // getBase() 在宿主未注册时会同步抛错，必须放进 Promise 链，否则会冒泡到 ErrorBoundary
    Promise.resolve()
      .then(() => (getBase() as any)?.getBaseName?.())
      .then((n: unknown) => {
        if (alive && typeof n === 'string' && n) setBaseName(n);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [baseToken, baseName]);

  // base 变化 → 拉表列表；当前 tableId 失效则回落到第一张表
  useEffect(() => {
    if (!baseToken) {
      setTables([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    listTables()
      .then((list) => {
        if (!alive) return;
        setTables(list);
        setConfig((prev) => {
          if (list.some((t) => t.id === prev.tableId)) return prev;
          return { ...prev, tableId: list[0]?.id };
        });
      })
      .catch((e) => {
        if (alive) setError(`读取数据表失败：${String((e as Error)?.message ?? e)}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [baseToken]);

  // table 变化 → 拉字段并用最新元信息校正配置
  useEffect(() => {
    const tableId = config.tableId;
    if (!tableId) {
      setFields([]);
      return;
    }
    let alive = true;
    setLoading(true);
    listFields(tableId)
      .then((list) => {
        if (!alive) return;
        setFields(list);
        setConfig((prev) => (prev.tableId === tableId ? syncConfig(prev, list) : prev));
      })
      .catch((e) => {
        if (alive) setError(`读取字段失败：${String((e as Error)?.message ?? e)}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [config.tableId]);

  const handleSelectBase = (token: string, name: string) => {
    if (token === baseToken) return;
    const doSwitch = async () => {
      const ok = await selectBase(token, name);
      if (!ok) {
        Toast.error('无法打开该多维表格，请检查权限');
        return;
      }
      setBaseToken(token);
      setBaseName(name);
      setTables([]);
      setFields([]);
      setConfig({ ...emptyConfig(), baseToken: token });
      Toast.success(`已切换到「${name}」，请重新配置`);
    };

    if (!config.tableId) {
      void doSwitch();
      return;
    }
    Modal.confirm({
      title: '切换多维表格？',
      content: '切换后当前未保存的分组与字段配置会被清空，仅保留新选多维表格自己的配置。',
      okText: '切换',
      cancelText: '取消',
      onOk: () => doSwitch(),
    });
  };

  const handleSave = async () => {
    if (!config.tableId) {
      Toast.error('请先选择数据表');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const bytes = await saveConfig(config);
      Toast.success(`配置已保存（${bytes} 字节）`);
      onSaved();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      setError(msg);
      Toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const shownFields = config.groups.reduce((n, g) => n + g.fieldIds.length, 0);

  return (
    <div className="cfg">
      <header className="cfg-header">
        <div>
          <h1>多维表格记录展示 · 配置</h1>
          <p className="cfg-sub">
            配置决定浏览页展示哪些字段、如何分组、哪些字段强调与必填。保存后普通用户在浏览页即可使用。
          </p>
        </div>
        <div className="cfg-header-actions">
          <Tag color={source === 'dashboard' ? 'green' : 'grey'} size="large">
            {SOURCE_LABEL[source]}
          </Tag>
          <Button theme="solid" type="primary" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </div>
      </header>

      {droppedForeign ? (
        <Banner
          type="warning"
          title="已忽略其它多维表格的配置"
          description="检测到该插件曾被用于另一个多维表格，本表配置需要重新确认后保存。"
          className="cfg-banner"
        />
      ) : null}

      {error ? (
        <Banner type="danger" title="操作失败" description={error} className="cfg-banner" closeIcon={null} />
      ) : null}

      <section className="cfg-card">
        <div className="cfg-card-head">
          <h2>1. 数据来源</h2>
          {loading ? <Spin size="small" /> : null}
        </div>
        <p className="cfg-hint">
          选择一个多维表格，再选择要展示的数据表。分组、字段规则与关联展示都只作用于这张表。
        </p>

        <BasePicker baseToken={baseToken} baseName={baseName} onSelect={handleSelectBase} />

        <div className="table-picker">
          <span className="table-picker-label">数据表</span>
          {tables.length === 0 ? (
            <span className="cfg-hint">{baseToken ? '该多维表格下没有数据表' : '请先选择多维表格'}</span>
          ) : (
            <Select
              value={config.tableId}
              onChange={(v) => setConfig((prev) => ({ ...prev, tableId: String(v) }))}
              optionList={tables.map((t) => ({ label: t.name, value: t.id }))}
              className="table-select"
            />
          )}
          {fields.length ? (
            <span className="cfg-hint">
              共 {fields.length} 个字段，已展示 {shownFields} 个
            </span>
          ) : null}
        </div>
      </section>

      {config.tableId ? (
        <>
          <GroupSection config={config} fields={fields} onChange={setConfig} />
          <FieldSection config={config} fields={fields} onChange={setConfig} />
          <SettingsSection config={config} fields={fields} onChange={setConfig} />
          <LinkSection config={config} fields={fields} onChange={setConfig} />
        </>
      ) : (
        <div className="cfg-card">
          <div className="cfg-empty">选择多维表格与数据表后开始配置</div>
        </div>
      )}

      <footer className="cfg-footer">
        <span className="cfg-hint">保存后关闭配置面板即可在浏览页看到效果。</span>
        <Button theme="solid" type="primary" loading={saving} onClick={handleSave}>
          保存配置
        </Button>
      </footer>
    </div>
  );
}