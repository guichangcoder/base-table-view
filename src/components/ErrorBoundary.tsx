import React from 'react';
import { Banner, Button } from '@douyinfe/semi-ui';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/** 兜底错误边界：宿主出现「配置数据发生变更」时先看这里 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
    this.setState({ info: info.componentStack ?? '' });
  }

  render(): React.ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="boundary">
        <Banner
          type="danger"
          title="插件渲染出错"
          description={
            <div className="boundary-body">
              <div className="boundary-msg">{String(error.message || error)}</div>
              {info ? <pre className="boundary-stack">{info.slice(0, 1200)}</pre> : null}
              <Button
                theme="solid"
                onClick={() => {
                  this.setState({ error: null, info: '' });
                  window.location.reload();
                }}
              >
                重新加载
              </Button>
            </div>
          }
        />
      </div>
    );
  }
}