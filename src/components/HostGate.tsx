import { Button, Typography } from '@douyinfe/semi-ui';
import { diagnoseAppContext } from '../services/appContext';

const { Title, Paragraph } = Typography;

/**
 * 非飞书宿主环境（浏览器直开 preview）的闸门页。
 * 应用模式插件必须由飞书仪表盘/应用页面加载，浏览器直开拿不到任何数据。
 */
export function HostGate(): JSX.Element {
  const diag = diagnoseAppContext();

  const copyDiag = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-badge">多维表格应用模式插件</div>
        <Title heading={3} className="gate-title">
          请在飞书多维表格中打开
        </Title>
        <Paragraph className="gate-desc">
          本插件是「多维表格应用模式」下的自定义页面组件，需要由飞书内部加载才能获取当前多维表格的数据与配置。
          直接在浏览器中打开只会看到这个页面，属于正常现象。
        </Paragraph>
        <div className="gate-steps">
          <div>1. 打开飞书多维表格，进入「应用模式」页面</div>
          <div>2. 添加自定义插件并选择本插件</div>
          <div>3. 在配置面板中选择多维表格与数据表，保存后即可使用</div>
        </div>
        <Button onClick={copyDiag}>复制环境诊断信息</Button>
        <pre className="gate-diag">{JSON.stringify(diag, null, 2)}</pre>
      </div>
    </div>
  );
}