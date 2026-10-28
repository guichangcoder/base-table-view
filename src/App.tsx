import { useEffect, useState } from 'react';
import { Spin, Banner } from '@douyinfe/semi-ui';
import { emptyConfig, type PluginData } from './types';
import {
  getHostState,
  isConfigState,
  loadConfig,
  type ConfigSource,
  type HostState,
} from './services/configService';
import { HostGate } from './components/HostGate';
import { ConfigPanel } from './components/config/ConfigPanel';
import { Workbench } from './components/view/Workbench';

export default function App() {
  const [hostState, setHostState] = useState<HostState>(() => getHostState());
  const [hostChecked, setHostChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<PluginData>(emptyConfig());
  const [source, setSource] = useState<ConfigSource>('none');
  const [dropped, setDropped] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // 宿主运行时可能晚于 iframe 挂载注册：轮询等待状态就绪（最多约 3 秒）
  useEffect(() => {
    if (hostState !== 'Unknown') {
      setHostChecked(true);
      return;
    }
    let alive = true;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (!alive) return;
      const next = getHostState();
      if (next !== 'Unknown') {
        setHostState(next);
        setHostChecked(true);
        window.clearInterval(timer);
      } else if (tries >= 15) {
        setHostChecked(true);
        window.clearInterval(timer);
      }
    }, 200);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [hostState]);

  useEffect(() => {
    if (!hostChecked) return;
    let alive = true;
    setLoading(true);
    loadConfig()
      .then((res) => {
        if (!alive) return;
        setConfig(res.config);
        setSource(res.source);
        setDropped(res.droppedForeign);
        setLoadError('');
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey, hostChecked]);

  if (!hostChecked) {
    return (
      <div className="app-loading">
        <Spin size="large" />
        <span>正在连接飞书…</span>
      </div>
    );
  }

  if (hostState === 'Unknown') return <HostGate />;

  if (loading) {
    return (
      <div className="app-loading">
        <Spin size="large" />
        <span>正在读取配置…</span>
      </div>
    );
  }

  const configMode = isConfigState(hostState);

  return (
    <div className="app">
      {loadError ? (
        <div className="app-error">
          <Banner type="danger" title="读取配置失败" description={loadError} />
        </div>
      ) : null}
      {configMode ? (
        <ConfigPanel
          initial={config}
          source={source}
          droppedForeign={dropped}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <Workbench config={config} />
      )}
    </div>
  );
}